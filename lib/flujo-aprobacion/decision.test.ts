import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoRechazo, avisosRevision } from "./avisos";
import { Decisor, planDecision, puedeDecidir, revisarTexto } from "./decision";
import type { ArchivoRegistro, PasoFlujo } from "./types";

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
  traslado: null,
  detectado: AHORA,
  actualizado: AHORA,
  ...extra,
});
/** The flow as it is now: Revisa = group Arquitectura, Aprueba = Pepe. */
const PASOS: PasoFlujo[] = [
  { id: "p1", nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq", nombre: "Arquitectura" } },
  { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe", nombre: "Pepe Gómez" } },
];
const FLUJO = { hito: "Aprobar Torre 1", pasos: PASOS };
const quien = (id: string, extra: Partial<Decisor> = {}): Decisor => ({ id, nombre: id, esAdmin: false, grupos: new Set(), ...extra });

test("decide solo el responsable del paso (o cualquiera de su grupo), no un administrador; nunca quien subió esa versión", () => {
  const a = archivo();
  assert.deepEqual(puedeDecidir(a, FLUJO, quien("luz", { grupos: new Set(["g-arq"]) })), { error: null, comoAdmin: false });
  // 11-11-2026: an administrator doesn't decide for the responsible.
  assert.match(puedeDecidir(a, FLUJO, quien("ana", { esAdmin: true })).error!, /^El paso «Revisa» de este archivo no es tuyo: lo decide Arquitectura \(grupo\), su responsable \(los administradores no deciden por el responsable\)\.$/);
  // …unless the step has no responsible (older flows), so the file isn't stuck.
  assert.deepEqual(puedeDecidir(a, { pasos: [{ id: "p1", nombre: "Revisa" }] }, quien("ana", { esAdmin: true })), { error: null, comoAdmin: true });
  assert.match(puedeDecidir(a, FLUJO, quien("pepe")).error!, /El paso «Revisa» de este archivo no es tuyo: lo decide Arquitectura \(grupo\), su responsable\.$/);
  assert.match(puedeDecidir(a, FLUJO, quien("juan", { esAdmin: true, grupos: new Set(["g-arq"]) })).error!, /Tú subiste esta versión/);
  assert.match(puedeDecidir(archivo({ estado: "aprobado" }), FLUJO, quien("ana", { esAdmin: true })).error!, /no espera revisión: está «Aprobado»/);
  assert.match(puedeDecidir(a, { pasos: [{ id: "p1", nombre: "Revisa" }] }, quien("luz")).error!, /no tiene responsable: solo un administrador puede decidirlo/);
  // A responsible changed in the flow reaches files already in process.
  const otro = { pasos: [{ ...PASOS[0], responsable: { tipo: "persona" as const, id: "luz", nombre: "Luz" } }, PASOS[1]] };
  assert.deepEqual(puedeDecidir(a, otro, quien("luz")), { error: null, comoAdmin: false });
});

test("el responsable nombrado decide aunque haya subido esa versión, y la firma lo dice; en un grupo decide otro miembro", () => {
  // Juan uploaded version 5 and is the step's responsible (the owner's case on 09-11-2026).
  const suyo = { pasos: [{ id: "p1", nombre: "Aprueba", responsable: { tipo: "persona" as const, id: "juan", nombre: "Juan Pérez" } }] };
  const a = archivo({ pasos: suyo.pasos });
  assert.deepEqual(puedeDecidir(a, suyo, quien("juan")), { error: null, comoAdmin: false });
  const plan = planDecision(a, "aprobar", quien("juan", { nombre: "Juan Pérez" }), false, "", AHORA);
  assert.equal(plan.firma.propia, true);
  assert.equal(plan.detalle, "Aprobó «Aprueba» de la versión 5 (su propia versión, como responsable del paso): el archivo queda aprobado.");
  assert.equal(planDecision(archivo(), "aprobar", quien("luz"), false, "", AHORA).firma.propia, undefined, "someone else's version");
  // Group responsible: the member who uploaded doesn't decide; another member does.
  assert.equal(puedeDecidir(archivo(), FLUJO, quien("juan", { grupos: new Set(["g-arq"]) })).error, "Tú subiste esta versión: la decide Arquitectura (grupo) (otra persona del grupo).");
  // An administrator who uploaded it and isn't the responsible doesn't either.
  assert.match(puedeDecidir(a, { pasos: [{ ...suyo.pasos[0], responsable: { tipo: "persona", id: "pepe", nombre: "Pepe" } }] }, quien("juan", { esAdmin: true })).error!, /Tú subiste esta versión: la decide Pepe\./);
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
  ];
  const avisos = avisosRevision(archivos, { ...FLUJO, codigo: 3, notas: "Revisar ejes", vence: "2026-11-30" }, (a) => `https://tc/${a.fileId}`);
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0].titulo, "Revisar 2 archivos (Revisa) — Aprobar Torre 1");
  assert.deepEqual(avisos[0].para, [{ tipo: "grupo", id: "g-arq", nombre: "Arquitectura" }]);
  assert.deepEqual(avisos[0].archivos, ["a1", "a2"]);
  assert.equal(avisos[0].pasoId, "p1");
  assert.deepEqual(avisos[0].correo, {
    tipo: "revision",
    codigo: "FLUJO-03",
    hito: "Aprobar Torre 1",
    notas: "Revisar ejes",
    vence: "2026-11-30",
    paso: "Revisa",
    archivos: [
      { nombre: "ARQ-T1.rvt", revision: 5, enlace: "https://tc/modelo", nueva: false },
      { nombre: "A-101.pdf", revision: 3, enlace: "https://tc/plano", nueva: true },
    ],
    mas: 0,
  });
  assert.equal(avisos[1].titulo, "Revisar: Memoria.docx (Aprueba) — Aprobar Torre 1");
  assert.equal("trimble" in avisos[0], false, "no Trimble ToDo since 19-11-2026: only the e-mail");
  assert.deepEqual(avisosRevision([archivo()], { hito: "x", pasos: [{ id: "p1", nombre: "Revisa" }] }, () => "u"), [], "a step without responsible: no notice");
});

test("el aviso de rechazo va a quien subió la versión, con el motivo y dónde subir la corrección", () => {
  const a = archivo();
  const r = planDecision(a, "rechazar", quien("luz"), false, "Faltan los ejes", AHORA);
  const aviso = avisoRechazo(a, r.firma, { hito: "Aprobar Torre 1" }, "https://tc/modelo")!;
  assert.equal(aviso.titulo, "Corregir: ARQ-T1.rvt (rechazado) — Aprobar Torre 1");
  assert.deepEqual(aviso.para, [{ tipo: "persona", id: "juan", nombre: "Juan Pérez" }]);
  assert.equal(aviso.tipo, "correccion");
  assert.deepEqual(aviso.correo?.rechazo, { quien: "luz", motivo: "Faltan los ejes", carpeta: "Obra / Arquitectura" });
  assert.deepEqual(aviso.correo?.archivos, [{ nombre: "ARQ-T1.rvt", revision: 5, enlace: "https://tc/modelo", nueva: false }]);
  assert.equal(avisoRechazo(archivo({ subidoPorId: null }), r.firma, { hito: "x" }, "u"), null);
});
