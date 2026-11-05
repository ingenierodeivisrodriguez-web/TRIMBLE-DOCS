import { test } from "node:test";
import assert from "node:assert/strict";
import type { Respuesta } from "../compras/cde";
import { avisoRechazo, avisosRevision, enviarAviso, MAX_EN_AVISO } from "./avisos";
import { Decisor, planDecision, puedeDecidir, revisarTexto } from "./decision";
import type { ArchivoRegistro, Asignacion } from "./types";

const AHORA = "2026-11-04T21:00:00.000Z";
const archivo = (extra: Partial<ArchivoRegistro> = {}): ArchivoRegistro => ({
  id: "a1",
  proyecto: "P",
  flujoId: "f1",
  fileId: "modelo",
  nombre: "ARQ-T1.rvt",
  ruta: "Obra / Arquitectura / ARQ-T1.rvt",
  carpetaId: "arq",
  ancestros: ["raiz", "arq"],
  tipo: "rvt",
  estado: "pendiente",
  pasos: [
    { id: "p1", nombre: "Revisa" },
    { id: "p2", nombre: "Aprueba" },
  ],
  pasoActual: 0,
  versionId: "modelo-v5",
  revision: 5,
  subido: "2026-11-03T15:00:00.000Z",
  subidoPor: "Juan Pérez",
  subidoPorId: "juan",
  versionAprobadaId: null,
  revisionAprobada: null,
  firmas: [],
  detectado: AHORA,
  actualizado: AHORA,
  ...extra,
});
const asig = (papel: string, quienTipo: "persona" | "grupo", quienId: string, quienNombre: string, objetivoId = "arq"): Asignacion => ({
  id: `${papel}-${quienId}`,
  flujoId: "f1",
  proyecto: "P",
  objetivoTipo: "carpeta",
  objetivoId,
  objetivoRuta: "",
  objetivoAncestros: ["raiz"],
  papel,
  quienTipo,
  quienId,
  quienNombre,
  activa: true,
  creado: AHORA,
  creadoPor: null,
});
const ASIG = [asig("p1", "grupo", "g-arq", "Arquitectura"), asig("p2", "persona", "pepe", "Pepe Gómez")];
const quien = (id: string, extra: Partial<Decisor> = {}): Decisor => ({ id, nombre: id, esAdmin: false, grupos: new Set(), ...extra });

test("decide quien tiene el paso (o cualquiera de su grupo) o un administrador; nunca quien subió esa versión", () => {
  const a = archivo();
  assert.deepEqual(puedeDecidir(a, ASIG, quien("luz", { grupos: new Set(["g-arq"]) })), { error: null, comoAdmin: false });
  assert.deepEqual(puedeDecidir(a, ASIG, quien("ana", { esAdmin: true })), { error: null, comoAdmin: true });
  assert.match(puedeDecidir(a, ASIG, quien("pepe")).error!, /El paso «Revisa» de este archivo no es tuyo: lo tiene Arquitectura \(grupo\)/);
  assert.match(puedeDecidir(a, ASIG, quien("juan", { esAdmin: true, grupos: new Set(["g-arq"]) })).error!, /Tú subiste esta versión/);
  assert.match(puedeDecidir(archivo({ estado: "aprobado" }), ASIG, quien("ana", { esAdmin: true })).error!, /no espera revisión: está «Aprobado»/);
  assert.match(puedeDecidir(a, [], quien("luz")).error!, /no tiene a nadie asignado y solo un administrador puede decidirlo/);
});

test("aprobar un paso pasa al siguiente y aprobar el último deja aprobada esa versión, con su firma", () => {
  const primero = planDecision(archivo(), "aprobar", quien("luz"), false, "", AHORA);
  assert.equal(primero.accion, "aprobado-paso");
  assert.equal(primero.cambios.pasoActual, 1);
  assert.equal(primero.siguiente?.nombre, "Aprueba");
  assert.equal(primero.detalle, "Aprobó «Revisa» de la versión 5: pasa a «Aprueba».");
  const ultimo = planDecision(archivo({ pasoActual: 1, firmas: [primero.firma] }), "aprobar", quien("pepe"), false, "Cumple el LOD 300", AHORA);
  assert.equal(ultimo.accion, "aprobado");
  assert.equal(ultimo.cambios.estado, "aprobado");
  assert.equal(ultimo.cambios.versionAprobadaId, "modelo-v5");
  assert.equal(ultimo.cambios.revisionAprobada, 5);
  assert.equal(ultimo.cambios.firmas?.length, 2);
  assert.equal(ultimo.detalle, "Aprobó «Aprueba» de la versión 5: el archivo queda aprobado. Comentario: Cumple el LOD 300");
});

test("rechazar exige motivo y deja el archivo rechazado; el administrador queda anotado como tal", () => {
  assert.match(revisarTexto("rechazar", "  ").error!, /Escribe el motivo del rechazo/);
  assert.equal(revisarTexto("aprobar", "").error, null);
  assert.match(revisarTexto("aprobar", "x".repeat(1001)).error!, /hasta 1000/);
  const r = planDecision(archivo({ pasoActual: 1 }), "rechazar", quien("ana"), true, "Faltan los ejes en la planta", AHORA);
  assert.equal(r.cambios.estado, "rechazado");
  assert.equal(r.firma.comoAdmin, true);
  assert.equal(r.detalle, "Rechazó la versión 5 en «Aprueba» (como administrador). Motivo: Faltan los ejes en la planta");
});

test("los avisos juntan los archivos que esperan a las mismas personas en el mismo paso", () => {
  const archivos = [
    archivo(),
    archivo({ id: "a2", fileId: "plano", nombre: "A-101.pdf", estado: "nueva-version", revision: 3 }),
    archivo({ id: "a3", fileId: "otro", nombre: "Memoria.docx", pasoActual: 1 }),
    archivo({ id: "a4", fileId: "sin", nombre: "Suelto.pdf", flujoId: "f2" }),
  ];
  const avisos = avisosRevision(archivos, ASIG, new Map([["f1", "Aprobar Torre 1"]]), (a) => `https://tc/${a.fileId}`);
  assert.equal(avisos.length, 2, "f2 has nobody assigned: no notice");
  assert.equal(avisos[0].titulo, "Revisar 2 archivos (Revisa) — Aprobar Torre 1");
  assert.deepEqual(avisos[0].para, [{ tipo: "grupo", id: "g-arq", nombre: "Arquitectura" }]);
  assert.match(avisos[0].descripcion, /• A-101.pdf — versión 3 \(versión nueva\): https:\/\/tc\/plano/);
  assert.equal(avisos[1].titulo, "Revisar: Memoria.docx (Aprueba) — Aprobar Torre 1");
  const muchos = avisosRevision(Array.from({ length: MAX_EN_AVISO + 3 }, (_, i) => archivo({ id: `x${i}`, fileId: `x${i}`, nombre: `x${i}.pdf` })), ASIG, new Map(), () => "u");
  assert.match(muchos[0].descripcion, /… y 3 más: ábrelos en Flujo de aprobación → Por revisar\./);
});

test("el aviso de rechazo va a quien subió la versión, con el motivo y dónde subir la corrección", () => {
  const a = archivo();
  const r = planDecision(a, "rechazar", quien("luz"), false, "Faltan los ejes", AHORA);
  const aviso = avisoRechazo(a, r.firma, "Aprobar Torre 1", "https://tc/modelo")!;
  assert.equal(aviso.titulo, "Corregir: ARQ-T1.rvt (rechazado) — Aprobar Torre 1");
  assert.deepEqual(aviso.para, [{ tipo: "persona", id: "juan", nombre: "Juan Pérez" }]);
  assert.match(aviso.descripcion, /luz rechazó la versión 5 en «Revisa».*\nMotivo: Faltan los ejes\nCorrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta \(Obra \/ Arquitectura\)/);
  assert.equal(avisoRechazo(archivo({ subidoPorId: null }), r.firma, "x", "u"), null);
});

test("si Trimble no acepta la tarea para un grupo, se manda a cada miembro; los errores no se lanzan", async () => {
  const pedidos: unknown[] = [];
  const crear = async (cuerpo: Record<string, unknown>): Promise<Respuesta> => {
    pedidos.push(cuerpo.assignees);
    const grupo = (cuerpo.assignees as { type: string }[]).some((x) => x.type === "GROUP");
    return grupo ? { estado: 400, cuerpo: { message: "invalid assignee" } } : { estado: 201, cuerpo: { id: "todo9" } };
  };
  const aviso = { titulo: "Revisar: x", descripcion: "d", para: [{ tipo: "grupo" as const, id: "g-arq", nombre: "Arquitectura" }, { tipo: "persona" as const, id: "pepe", nombre: "Pepe" }], archivos: ["a1"] };
  const r = await enviarAviso(crear, "P", aviso, async () => [{ id: "luz" }, { id: "pepe" }]);
  assert.equal(r.ok, true);
  assert.equal(r.todoId, "todo9");
  assert.match(r.mensaje, /a cada miembro del grupo/);
  assert.deepEqual(pedidos[1], [
    { id: "pepe", type: "USER" },
    { id: "luz", type: "USER" },
  ]);
  const falla = await enviarAviso(async () => {
    throw new Error("red caída");
  }, "P", aviso, async () => []);
  assert.equal(falla.ok, false);
  assert.match(falla.mensaje, /red caída/);
});
