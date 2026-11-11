import { test } from "node:test";
import assert from "node:assert/strict";
import type { Respuesta } from "../compras/cde";
import { avisoRechazo, avisosRevision, enviarAviso, MAX_EN_AVISO, textosTarea, variantesTarea } from "./avisos";
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

test("decide el responsable del paso (o cualquiera de su grupo) o un administrador; nunca quien subió esa versión", () => {
  const a = archivo();
  assert.deepEqual(puedeDecidir(a, FLUJO, quien("luz", { grupos: new Set(["g-arq"]) })), { error: null, comoAdmin: false });
  assert.deepEqual(puedeDecidir(a, FLUJO, quien("ana", { esAdmin: true })), { error: null, comoAdmin: true });
  assert.match(puedeDecidir(a, FLUJO, quien("pepe")).error!, /El paso «Revisa» de este archivo no es tuyo: lo tiene Arquitectura \(grupo\)/);
  assert.match(puedeDecidir(a, FLUJO, quien("juan", { esAdmin: true, grupos: new Set(["g-arq"]) })).error!, /Tú subiste esta versión/);
  assert.match(puedeDecidir(archivo({ estado: "aprobado" }), FLUJO, quien("ana", { esAdmin: true })).error!, /no espera revisión: está «Aprobado»/);
  assert.match(puedeDecidir(a, { pasos: [{ id: "p1", nombre: "Revisa" }] }, quien("luz")).error!, /no tiene responsable y solo un administrador puede decidirlo/);
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
  const avisos = avisosRevision(archivos, FLUJO, (a) => `https://tc/${a.fileId}`);
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0].titulo, "Revisar 2 archivos (Revisa) — Aprobar Torre 1");
  assert.deepEqual(avisos[0].para, [{ tipo: "grupo", id: "g-arq", nombre: "Arquitectura" }]);
  assert.match(avisos[0].descripcion, /• A-101.pdf — versión 3 \(versión nueva\): https:\/\/tc\/plano/);
  assert.equal(avisos[1].titulo, "Revisar: Memoria.docx (Aprueba) — Aprobar Torre 1");
  const muchos = avisosRevision(Array.from({ length: MAX_EN_AVISO + 3 }, (_, i) => archivo({ id: `x${i}`, fileId: `x${i}`, nombre: `x${i}.pdf` })), FLUJO, () => "u");
  assert.match(muchos[0].descripcion, /… y 3 más: ábrelos en Flujo de aprobación, flujo «Aprobar Torre 1» → Archivos → Me toca\./);
  assert.deepEqual(avisosRevision([archivo()], { hito: "x", pasos: [{ id: "p1", nombre: "Revisa" }] }, () => "u"), [], "a step without responsible: no notice");
});

test("el aviso de rechazo va a quien subió la versión, con el motivo y dónde subir la corrección", () => {
  const a = archivo();
  const r = planDecision(a, "rechazar", quien("luz"), false, "Faltan los ejes", AHORA);
  const aviso = avisoRechazo(a, r.firma, { hito: "Aprobar Torre 1" }, "https://tc/modelo")!;
  assert.equal(aviso.titulo, "Corregir: ARQ-T1.rvt (rechazado) — Aprobar Torre 1");
  assert.deepEqual(aviso.para, [{ tipo: "persona", id: "juan", nombre: "Juan Pérez" }]);
  assert.match(aviso.descripcion, /luz rechazó la versión 5 en «Revisa».*\nMotivo: Faltan los ejes\nCorrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta \(Obra \/ Arquitectura\)/);
  assert.equal(avisoRechazo(archivo({ subidoPorId: null }), r.firma, { hito: "x" }, "u"), null);
});

test("la tarea de Trimble lleva el código del flujo, solo su título, solo su descripción y su fecha de vencimiento", () => {
  assert.deepEqual(textosTarea({ hito: "CARGAR ARCHIVO", notas: "PERMITE CARGAR", vence: "2026-11-11", codigo: 1 }), {
    label: "FLUJO-01",
    title: "CARGAR ARCHIVO",
    description: "PERMITE CARGAR",
    dueDate: "2026-11-11T17:00:00+0000",
  });
  const sinNada = textosTarea({ hito: "Aprobar Torre 1", notas: "  ", vence: null, codigo: null });
  assert.equal(sinNada.label, "", "before the SQL gives it a number: Trimble numbers the ToDo");
  assert.equal(sinNada.description, "Aprobar Torre 1", "Trimble requires a description: the title again");
  assert.equal(sinNada.dueDate, null);
  assert.equal(textosTarea({ hito: "x", codigo: 105 }).label, "FLUJO-105");
});

test("si Trimble no acepta el tipo, la fecha o el código repetido, se prueba sin ese dato y al final con el texto de antes", () => {
  const aviso = { titulo: "Revisar: a.pdf (Revisa) — X", descripcion: "detalle", para: [], archivos: ["a1"], trimble: { label: "FLUJO-03", title: "X", description: "D", dueDate: "2026-11-30T17:00:00+0000" } };
  const v = variantesTarea("P", aviso, [{ id: "luz", type: "USER" }], "FLUJO-03-2");
  assert.deepEqual(
    v.map((x) => [x.cuerpo.label, x.cuerpo.type ?? null, x.cuerpo.dueDate ? "fecha" : null, x.cuerpo.title ?? null]),
    [
      ["FLUJO-03", "Flujo de aprobación", "fecha", "X"],
      ["FLUJO-03", "Request", "fecha", "X"],
      ["FLUJO-03", null, "fecha", "X"],
      ["FLUJO-03-2", "Flujo de aprobación", "fecha", "X"],
      ["FLUJO-03-2", "Request", "fecha", "X"],
      ["FLUJO-03-2", null, "fecha", "X"],
      ["FLUJO-03-2", null, null, "X"],
      ["Revisar: a.pdf (Revisa) — X", null, null, null],
    ]
  );
  assert.equal(v[0].nota, "");
  assert.match(v[1].nota, /tipo «Solicitud»/);
  assert.match(v[3].nota, /«FLUJO-03» ya estaba usada en Trimble/);
  assert.deepEqual(variantesTarea("P", { ...aviso, trimble: undefined }, []).length, 1, "a notice without the flow's texts: the format of before");
});

test("Trimble rechaza el tipo propio y el código repetido: la tarea sale con «Solicitud» y FLUJO-03-2, y el historial lo dice", async () => {
  const pedidos: Record<string, unknown>[] = [];
  const crear = async (cuerpo: Record<string, unknown>): Promise<Respuesta> => {
    pedidos.push(cuerpo);
    if (cuerpo.type === "Flujo de aprobación") return { estado: 400, cuerpo: { message: "Invalid type" } };
    if (cuerpo.label === "FLUJO-03") return { estado: 409, cuerpo: { message: "label already exists" } };
    return { estado: 201, cuerpo: { id: "todo5" } };
  };
  const aviso = { titulo: "Revisar: a.pdf (Aprueba) — X", descripcion: "d", para: [{ tipo: "persona" as const, id: "pepe", nombre: "Pepe" }], archivos: ["a1"], trimble: { label: "FLUJO-03", title: "X", description: "D", dueDate: null } };
  const r = await enviarAviso(crear, "P", aviso, async () => [], "FLUJO-03-2");
  assert.equal(r.ok, true);
  assert.equal(r.etiqueta, "FLUJO-03-2");
  assert.equal(pedidos.length, 5);
  assert.equal(r.mensaje, "Tarea de Trimble FLUJO-03-2 para Pepe: «Revisar: a.pdf (Aprueba) — X» (tipo «Solicitud»: Trimble no aceptó «Flujo de aprobación»; «FLUJO-03» ya estaba usada en Trimble).");
  // Without permission it doesn't keep trying.
  let veces = 0;
  const sinPermiso = await enviarAviso(async () => (veces++, { estado: 403, cuerpo: "Forbidden" }), "P", aviso, async () => []);
  assert.equal(sinPermiso.ok, false);
  assert.equal(veces, 1);
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
