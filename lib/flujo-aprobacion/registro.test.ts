import { test } from "node:test";
import assert from "node:assert/strict";
import { claveHito } from "./flujos";
import { detalleCambio, extension, meToca, planRegistro, responsablesArchivo, textoEstado } from "./registro";
import type { ArchivoRegistro, ArchivoVisto, Asignacion, Flujo } from "./types";

const AHORA = "2026-11-04T20:00:00.000Z";
const flujo = (id = "f1", pasos = [{ id: "p1", nombre: "Revisa" }, { id: "p2", nombre: "Aprueba" }]): Flujo => ({
  id,
  proyecto: "P",
  hito: id === "f1" ? "Aprobar diseño Torre 1" : "Aprobar estructura",
  hitoClave: claveHito(id),
  pasos,
  carpetas: [{ id: "arq", ruta: "Obra / Arq", ancestros: ["raiz"] }],
  destino: { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] },
  activo: true,
  version: 1,
  creado: AHORA,
  creadoPor: "Ana",
  actualizado: AHORA,
  actualizadoPor: "Ana",
});

const visto = (fileId: string, revision: number, extra: Partial<ArchivoVisto> = {}): ArchivoVisto => ({
  fileId,
  nombre: `${fileId}.rvt`,
  versionId: `${fileId}-v${revision}`,
  revision,
  subido: "2026-11-03T19:20:00.000Z",
  subidoPor: "Juan Pérez",
  subidoPorId: "juan",
  carpetaId: "arq",
  ancestros: ["raiz", "arq"],
  ruta: `Obra / Arq / ${fileId}.rvt`,
  ...extra,
});

const registrado = (fileId: string, revision: number, extra: Partial<ArchivoRegistro> = {}): ArchivoRegistro => ({
  id: `r-${fileId}`,
  proyecto: "P",
  flujoId: "f1",
  fileId,
  nombre: `${fileId}.rvt`,
  ruta: `Obra / Arq / ${fileId}.rvt`,
  carpetaId: "arq",
  ancestros: ["raiz", "arq"],
  tipo: "rvt",
  estado: "pendiente",
  pasos: [
    { id: "p1", nombre: "Revisa" },
    { id: "p2", nombre: "Aprueba" },
  ],
  pasoActual: 0,
  versionId: `${fileId}-v${revision}`,
  revision,
  subido: "2026-11-01T15:00:00.000Z",
  subidoPor: "Ana Ruiz",
  subidoPorId: "ana",
  versionAprobadaId: null,
  revisionAprobada: null,
  firmas: [],
  traslado: null,
  detectado: "2026-11-01T16:00:00.000Z",
  actualizado: "2026-11-01T16:00:00.000Z",
  ...extra,
});

test("un archivo nuevo queda pendiente de revisión, con quién lo subió y cuándo según Trimble, y con copia de los pasos", () => {
  const p = planRegistro(flujo(), [], [visto("modelo", 1)], AHORA);
  assert.equal(p.crear.length, 1);
  const a = p.crear[0];
  assert.equal(a.estado, "pendiente");
  assert.equal(a.subidoPor, "Juan Pérez");
  assert.equal(a.subido, "2026-11-03T19:20:00.000Z");
  assert.equal(a.detectado, AHORA);
  assert.equal(a.tipo, "rvt");
  assert.deepEqual(a.pasos, flujo().pasos);
  assert.equal(a.pasoActual, 0);
});

test("una versión nueva mientras espera revisión reemplaza a la anterior y vuelve al primer paso, sin cambiar sus pasos", () => {
  const antes = registrado("modelo", 2, { pasoActual: 1, pasos: [{ id: "p1", nombre: "Revisión vieja" }, { id: "p2", nombre: "Aprueba" }] });
  const p = planRegistro(flujo(), [antes], [visto("modelo", 3)], AHORA);
  assert.equal(p.actualizar.length, 1);
  const c = p.actualizar[0];
  assert.equal(c.accion, "version-reemplazada");
  assert.equal(c.cambios.revision, 3);
  assert.equal(c.cambios.pasoActual, 0);
  assert.equal(c.cambios.estado, undefined, "keeps its state");
  assert.equal(c.cambios.pasos, undefined, "keeps the steps it started with");
  assert.equal(
    detalleCambio(c, "x", (iso) => iso.slice(0, 10)),
    "Subió la versión 3 el 2026-11-03 mientras la versión 2 esperaba revisión: se revisa la nueva desde el primer paso."
  );
});

test("una versión nueva después de aprobado o rechazado queda como nueva versión pendiente, con los pasos actuales del flujo", () => {
  const actual = flujo("f1", [{ id: "p2", nombre: "Aprueba" }]);
  for (const estado of ["aprobado", "rechazado"] as const) {
    const antes = registrado("modelo", 5, { estado, versionAprobadaId: estado === "aprobado" ? "modelo-v5" : null, revisionAprobada: estado === "aprobado" ? 5 : null });
    const c = planRegistro(actual, [antes], [visto("modelo", 6)], AHORA).actualizar[0];
    assert.equal(c.accion, "nueva-version");
    assert.equal(c.cambios.estado, "nueva-version");
    assert.deepEqual(c.cambios.pasos, [{ id: "p2", nombre: "Aprueba" }]);
    if (estado === "aprobado") assert.match(detalleCambio(c, "x", (s) => s), /nueva versión pendiente de revisión \(la aprobada es la 5\)/);
  }
});

test("lo que no se vio queda para comprobarlo en Trimble; lo retirado que reaparece vuelve a su estado", () => {
  const p = planRegistro(
    flujo(),
    [
      registrado("modelo", 1),
      registrado("plano", 2, { estado: "retirado", versionAprobadaId: "plano-v2", revisionAprobada: 2 }),
      registrado("viejo", 1, { estado: "retirado" }),
      registrado("ajeno", 1, { flujoId: "f2" }),
    ],
    [visto("plano", 2)],
    AHORA
  );
  assert.deepEqual(
    p.faltantes.map((r) => r.fileId),
    ["modelo"]
  );
  assert.equal(p.actualizar[0].accion, "archivo-reaparecido");
  assert.equal(p.actualizar[0].cambios.estado, "aprobado");
});

test("un archivo que llega desde otro flujo empieza de nuevo con este flujo", () => {
  const c = planRegistro(flujo(), [registrado("modelo", 3, { flujoId: "f2", estado: "aprobado", versionAprobadaId: "modelo-v3", revisionAprobada: 3 })], [visto("modelo", 3)], AHORA).actualizar[0];
  assert.equal(c.accion, "archivo-cambio-flujo");
  assert.equal(c.cambios.flujoId, "f1");
  assert.equal(c.cambios.estado, "pendiente");
  assert.equal(c.cambios.revisionAprobada, null);
});

test("renombrar o mover dentro del flujo solo actualiza la ruta, sin historial; lo igual no cambia", () => {
  const p = planRegistro(flujo(), [registrado("modelo", 1), registrado("plano", 1)], [visto("modelo", 1, { ruta: "Obra / Arq / Torre 1 / modelo.rvt", ancestros: ["raiz", "arq", "t1"], carpetaId: "t1" }), visto("plano", 1)], AHORA);
  assert.equal(p.actualizar[0].accion, "");
  assert.equal(p.actualizar[0].cambios.carpetaId, "t1");
  assert.equal(p.sinCambios, 1);
});

const asig = (objetivoId: string, ancestros: string[], papel: string, quienTipo: "persona" | "grupo", quienId: string): Asignacion => ({
  id: `${objetivoId}-${papel}-${quienId}`,
  flujoId: "f1",
  proyecto: "P",
  objetivoTipo: "carpeta",
  objetivoId,
  objetivoRuta: "",
  objetivoAncestros: ancestros,
  papel,
  quienTipo,
  quienId,
  quienNombre: quienId,
  activa: true,
  creado: AHORA,
  creadoPor: null,
});

test("le toca a quien tiene el paso actual (persona o su grupo), nunca a quien subió esa versión", () => {
  const a = registrado("modelo", 1, { subidoPorId: "juan" });
  const asignaciones = [asig("arq", ["raiz"], "p1", "persona", "juan"), asig("arq", ["raiz"], "p1", "grupo", "g-arq"), asig("arq", ["raiz"], "p2", "persona", "pepe")];
  const r = responsablesArchivo(a, asignaciones);
  assert.deepEqual(
    r.map((x) => x.quienId),
    ["juan", "g-arq"]
  );
  assert.equal(meToca(a, r, "juan", new Set()), false, "Juan uploaded it");
  assert.equal(meToca(a, r, "luz", new Set(["g-arq"])), true);
  assert.equal(meToca(a, r, "pepe", new Set()), false, "not his step yet");
  assert.deepEqual(responsablesArchivo({ ...a, pasoActual: 1 }, asignaciones).map((x) => x.quienId), ["pepe"]);
  assert.deepEqual(responsablesArchivo({ ...a, estado: "aprobado" }, asignaciones), []);
});

test("los estados se dicen en palabras", () => {
  assert.equal(textoEstado({ estado: "pendiente", revisionAprobada: null }), "Pendiente de revisión");
  assert.equal(textoEstado({ estado: "nueva-version", revisionAprobada: 5 }), "Nueva versión pendiente de revisión (aprobada: v5)");
  assert.equal(textoEstado({ estado: "retirado", revisionAprobada: null }), "Retirado");
  assert.equal(extension("Plano A-101.PDF"), "pdf");
  assert.equal(extension("sin-extension"), "");
});
