import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import type { Correo, MensajeCorreo } from "./correo";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
import { reactivarFlujo } from "./reactivar";
import { listarArchivos, revisarFlujo } from "./revision";
import { cambiarEstado, Ctx, estado, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("eva", "Eva")];

/** A model uploaded by Juan; Revisa = group Arquitectura (Luz, Eva), Aprueba = Pepe. */
async function escenario() {
  const store = memoryStore();
  const arbol: Record<string, RawFolderItem[]> = {};
  const archivo = (id: string, name: string, revision: number, quien = "juan"): RawFolderItem => ({
    id,
    name,
    type: "FILE",
    createdOn: "",
    modifiedOn: `2026-11-0${revision}T15:00:00.000Z`,
    modifiedBy: { id: quien, firstName: PERSONAS.find((p) => p.id === quien)!.firstName },
    versionId: `${id}-v${revision}`,
    revision,
  });
  arbol.arq = [archivo("modelo", "modelo.rvt", 1)];
  const correos: MensajeCorreo[] = [];
  const correo: Correo = { desde: "avisos@gmail.com", enviar: async (m) => void correos.push(m) };
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => PERSONAS,
    grupos: async () => [{ id: "g-arq", name: "Arquitectura" }],
    miembros: async (g) => (g === "g-arq" ? [PERSONAS[2], PERSONAS[4]] : []),
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => arbol[id] ?? [],
    version: async (id) => arbol.arq.find((x) => x.id === id)?.versionId ?? null,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async (ids) => new Set(ids.filter((g) => g === "g-arq" && (id === "luz" || id === "eva"))) } satisfies Caller,
    store,
    tc,
    correo,
    ahora: () => new Date("2026-11-04T22:00:00Z"),
  });
  const admin = ctx("ana", true);
  const guardado = await guardarFlujo(admin, {
    hito: "Aprobar Torre 1",
    archivos: ["modelo"],
    pasos: [
      { nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq" } },
      { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
    ],
  });
  const f = guardado.flujos[0];
  const registro = { mensaje: guardado.mensaje ?? "" };
  const modelo = async () => (await listarArchivos(admin)).archivos.find((a) => a.fileId === "modelo")!;
  return { store, arbol, archivo, correos, ctx, admin, f, registro, modelo };
}

test("al registrar un archivo nuevo se avisa por correo a quien tiene el primer paso, sin crear tarea en Trimble", async () => {
  const e = await escenario();
  assert.match(e.registro.mensaje, /1 archivo nuevo\. Se avisó a los revisores con 2 correos\./);
  assert.deepEqual(e.correos.map((m) => m.para.correo).sort(), ["eva@obra.co", "luz@obra.co"], "both members of the group");
  assert.equal(e.correos[0].asunto, "FLUJO-01 · Te toca «Revisa»: Aprobar Torre 1");
  const h = await historial(e.admin, e.f.id);
  assert.ok(h.entradas.some((x) => x.accion === "correo-enviado"));
  assert.equal(h.entradas.filter((x) => x.accion === "aviso-enviado").length, 0, "no Trimble ToDo since 19-11-2026");
});

test("paso a paso: alguien del grupo revisa, Pepe aprueba; queda aprobada esa versión con sus firmas", async () => {
  const e = await escenario();
  let a = await e.modelo();
  const r1 = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  assert.equal(r1.mensaje, "Aprobaste «Revisa» de «modelo.rvt»: pasa a «Aprueba».");
  assert.equal(r1.aviso, "Correo a Pepe <pepe@obra.co>: «FLUJO-01 · Te toca «Aprueba»: Aprobar Torre 1».");
  assert.equal(e.correos[e.correos.length - 1].para.correo, "pepe@obra.co");
  a = await e.modelo();
  assert.equal(a.pasoNombre, "Aprueba");
  // Eva (same group) can't approve a step that is no longer hers.
  await assert.rejects(() => decidir(e.ctx("eva"), { archivoId: a.id, versionId: a.versionId }, "aprobar"), /El paso «Aprueba» de este archivo no es tuyo: lo decide Pepe, su responsable/);
  const r2 = await decidir(e.ctx("pepe"), { archivoId: a.id, versionId: a.versionId, texto: "Cumple" }, "aprobar");
  assert.equal(r2.mensaje, "«modelo.rvt» queda aprobado (versión 1).");
  assert.equal(r2.traslado, null, "a flow without destination: the approved version stays where it is");
  a = await e.modelo();
  assert.equal(a.estado, "aprobado");
  assert.equal(a.revisionAprobada, 1);
  assert.deepEqual(
    a.firmas.map((f) => [f.paso, f.quien, f.decision, f.comentario]),
    [
      ["Revisa", "Luz", "aprobado", ""],
      ["Aprueba", "Pepe", "aprobado", "Cumple"],
    ]
  );
  const h = (await historial(e.admin, null, a.id)).entradas.map((x) => x.accion);
  assert.ok(h.includes("aprobado-paso") && h.includes("aprobado"));
});

test("rechazar exige motivo y avisa a quien subió; la versión corregida queda como aviso, sin entrar sola al flujo", async () => {
  const e = await escenario();
  let a = await e.modelo();
  await assert.rejects(() => decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "rechazar"), /Escribe el motivo del rechazo/);
  const r = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "Faltan los ejes" }, "rechazar");
  assert.equal(r.mensaje, "«modelo.rvt» queda rechazado (versión 1).");
  assert.equal(r.aviso, "Correo a Juan <juan@obra.co>: «FLUJO-01 · Rechazado: corrige «modelo.rvt» — Aprobar Torre 1».");
  assert.match(e.correos[e.correos.length - 1].texto, /Motivo: Faltan los ejes/);
  a = await e.modelo();
  assert.equal(a.estado, "rechazado");
  assert.equal(a.firmas[0].comentario, "Faltan los ejes");

  // The corrected version doesn't enter this flow by itself (10-11-2026): it is only noted.
  const correosAntes = e.correos.length;
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  const otra = await revisarFlujo(e.ctx("juan"), { flujoId: e.f.id });
  assert.match(otra.mensaje, /1 versión nueva en Trimble/);
  a = await e.modelo();
  assert.equal(a.estado, "rechazado");
  assert.equal(a.revision, 1);
  assert.equal(a.versionNueva?.revision, 2);
  assert.equal(a.firmas.length, 1, "the rejection stays");
  assert.equal(e.correos.length, correosAntes, "no e-mail: nothing new to review in this flow");
});

test("se decide solo la versión del flujo; si en Trimble hay una más nueva, se decide igual y queda anotado", async () => {
  const e = await escenario();
  const a = await e.modelo();
  await assert.rejects(
    () => decidir(e.ctx("luz"), { archivoId: a.id, versionId: "modelo-v0" }, "aprobar"),
    (err: unknown) => err instanceof FlujoError && err.code === "version-cambio"
  );
  // Version 2 is already in Trimble, before anyone pressed «Revisar ahora».
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  const r1 = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  assert.equal(r1.mensaje, "Aprobaste «Revisa» de «modelo.rvt»: pasa a «Aprueba». Ojo: en Trimble ya existe una versión más nueva; este flujo no la revisa.");
  // After a review the notice knows its number.
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  const b = await e.modelo();
  assert.equal(b.versionId, "modelo-v1");
  const r2 = await decidir(e.ctx("pepe"), { archivoId: b.id, versionId: b.versionId, texto: "Cumple" }, "aprobar");
  assert.equal(r2.mensaje, "«modelo.rvt» queda aprobado (versión 1). Ojo: en Trimble ya existe la versión 2; este flujo no la revisa.");
  assert.match((await historial(e.admin, null, b.id)).entradas.find((x) => x.accion === "aprobado")!.detalle, /el archivo queda aprobado\. Comentario: Cumple\. Ojo: en Trimble ya existe la versión 2\.$/);
  const c = await e.modelo();
  assert.equal(c.revisionAprobada, 1);
  assert.equal(c.estado, "aprobado");
});

test("el responsable que subió la versión ve que le toca y la decide; la firma y el historial lo anotan", async () => {
  const e = await escenario();
  // Juan uploaded modelo.rvt and becomes the responsible of «Revisa» (as in the owner's project on 09-11-2026).
  await guardarFlujo(e.admin, {
    id: e.f.id,
    version: e.f.version,
    hito: e.f.hito,
    archivos: ["modelo"],
    pasos: [
      { id: "p1", nombre: "Revisa", responsable: { tipo: "persona", id: "juan" } },
      { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
    ],
  });
  const deJuan = (await listarArchivos(e.ctx("juan"))).archivos.find((x) => x.fileId === "modelo")!;
  assert.equal(deJuan.meToca, true);
  const r = await decidir(e.ctx("juan"), { archivoId: deJuan.id, versionId: deJuan.versionId }, "aprobar");
  assert.equal(r.mensaje, "Aprobaste «Revisa» de «modelo.rvt»: pasa a «Aprueba».");
  const a = await e.modelo();
  assert.equal(a.firmas[0].propia, true);
  assert.match((await historial(e.admin, null, a.id)).entradas.find((x) => x.accion === "aprobado-paso")!.detalle, /de la versión 1 \(su propia versión, como responsable del paso\): pasa a «Aprueba»/);
});

test("un administrador no decide por el responsable; solo un paso sin responsable, y queda anotado", async () => {
  const e = await escenario();
  let a = await e.modelo();
  // The flow's version as uploaded by Ana, an administrator without the step.
  await e.store.actualizarArchivo(a.id, { subidoPor: "Ana", subidoPorId: "ana" });
  a = await e.modelo();
  await assert.rejects(() => decidir(e.admin, { archivoId: a.id, versionId: a.versionId }, "aprobar"), /Tú subiste esta versión/);
  await e.store.actualizarArchivo(a.id, { subidoPor: "Juan", subidoPorId: "juan" });
  a = await e.modelo();
  await assert.rejects(() => decidir(e.ctx("pepe"), { archivoId: a.id, versionId: a.versionId }, "aprobar"), /no es tuyo/);
  // 11-11-2026: the step has a responsible (the group Arquitectura), so Ana can't decide it.
  await assert.rejects(() => decidir(e.admin, { archivoId: a.id, versionId: a.versionId }, "aprobar"), /los administradores no deciden por el responsable/);
  // A step without responsible (older flows): only an administrator decides it.
  await e.store.actualizarArchivo(a.id, { pasos: [{ id: "p1", nombre: "Revisa" }, { id: "p2", nombre: "Aprueba" }] });
  await e.store.actualizarFlujo(e.f.id, (await e.store.flujo(e.f.id))!.version, { pasos: [{ id: "p1", nombre: "Revisa" }, { id: "p2", nombre: "Aprueba" }] });
  a = await e.modelo();
  await decidir(e.admin, { archivoId: a.id, versionId: a.versionId }, "aprobar");
  a = await e.modelo();
  assert.equal(a.firmas[0].comoAdmin, true);
  assert.match((await historial(e.admin, null, a.id)).entradas.find((x) => x.accion === "aprobado-paso")!.detalle, /\(como administrador\)/);
});

test("dos personas del grupo aprueban a la vez: la segunda recibe que ya se decidió", async () => {
  const e = await escenario();
  const a = await e.modelo();
  const [uno, dos] = await Promise.allSettled([
    decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar"),
    decidir(e.ctx("eva"), { archivoId: a.id, versionId: a.versionId }, "aprobar"),
  ]);
  assert.equal(uno.status, "fulfilled");
  assert.equal(dos.status, "rejected");
  assert.match(String((dos as PromiseRejectedResult).reason?.message), /Otra persona decidió sobre este archivo/);
  assert.equal((await e.modelo()).firmas.length, 1);
});

/** The flow's own steps again (Revisa = group Arquitectura, Aprueba = Pepe), with a due date. */
test("el mismo archivo en dos flujos activos: cada flujo lo decide por su cuenta", async () => {
  const e = await escenario();
  const otro = await guardarFlujo(e.admin, {
    hito: "Inspeccionar Torre 1",
    archivos: ["modelo"],
    pasos: [{ nombre: "Inspecciona", responsable: { tipo: "persona", id: "juan" } }],
  });
  assert.match(otro.mensaje ?? "", /1 archivo nuevo/);
  const g = otro.flujos.find((x) => x.hito === "Inspeccionar Torre 1")!;
  const deModelo = async () => (await listarArchivos(e.admin)).archivos.filter((a) => a.fileId === "modelo");
  const antes = await deModelo();
  assert.equal(antes.length, 2);
  const enA = antes.find((a) => a.flujoId === e.f.id)!;
  const enB = antes.find((a) => a.flujoId === g.id)!;
  const r = await decidir(e.ctx("juan"), { archivoId: enB.id, versionId: enB.versionId, texto: "Sin observaciones" }, "aprobar");
  assert.equal(r.mensaje, "«modelo.rvt» queda aprobado (versión 1).");
  let despues = await deModelo();
  assert.equal(despues.find((a) => a.id === enB.id)!.estado, "aprobado");
  assert.equal(despues.find((a) => a.id === enA.id)!.estado, "pendiente");
  assert.equal(despues.find((a) => a.id === enA.id)!.pasoNombre, "Revisa");
  // Reviewing the first flow again leaves the second one's record as it is.
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  despues = await deModelo();
  assert.equal(despues.length, 2);
  assert.equal(despues.find((a) => a.id === enB.id)!.estado, "aprobado");
});

const mismosPasos = (f: { id: string; version: number; hito: string }, vence: string) => ({
  id: f.id,
  version: f.version,
  hito: f.hito,
  archivos: ["modelo"],
  pasos: [
    { id: "p1", nombre: "Revisa", responsable: { tipo: "grupo" as const, id: "g-arq" } },
    { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona" as const, id: "pepe" } },
  ],
  vence,
});
const cerrado = (err: unknown) =>
  err instanceof FlujoError &&
  err.code === "flujo-cerrado" &&
  err.status === 409 &&
  /ya terminó: todos sus archivos quedaron aprobados \(la última decisión el \d\d-\d\d-\d{4}, de Pepe\)\. El flujo quedó cerrado y no se puede editar, activar ni desactivar/.test(err.message);

test("la última decisión cierra el flujo: cuando Luz revisa sigue abierto y su creador lo edita; cuando Pepe aprueba nadie lo edita ni lo desactiva, y sigue anotando versiones nuevas", async () => {
  const e = await escenario();
  let a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  const abierto = await estado(e.admin);
  assert.deepEqual(abierto.cierres, {}, "a step approved doesn't close it");
  // Its creator (an administrator here) still changes it.
  const editado = await guardarFlujo(e.admin, mismosPasos(abierto.flujos[0], "2026-11-20"));
  assert.equal(editado.flujos[0].vence, "2026-11-20");
  a = await e.modelo();
  await decidir(e.ctx("pepe"), { archivoId: a.id, versionId: a.versionId, texto: "Cumple" }, "aprobar");
  const st = await estado(e.ctx("juan"));
  const f = st.flujos[0];
  assert.equal(st.cierres[f.id]?.quien, "Pepe", "everyone sees it closed, by the last approval");
  await assert.rejects(() => guardarFlujo(e.admin, mismosPasos(f, "2026-11-30")), cerrado);
  await assert.rejects(() => cambiarEstado(e.admin, { id: f.id, version: f.version, activo: false }), cerrado);
  assert.equal((await estado(e.admin)).flujos[0].vence, "2026-11-20", "nothing changed");
  // A newer version is still noted.
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  assert.match((await revisarFlujo(e.ctx("juan"), { flujoId: f.id })).mensaje, /1 versión nueva/);
});

test("con dos archivos se cierra cuando el último queda aprobado; un rechazo lo deja abierto y reactivarlo lo vuelve a abrir", async () => {
  const e = await escenario();
  e.arbol.arq = [...e.arbol.arq, e.archivo("plano", "plano.pdf", 1)];
  let st = await guardarFlujo(e.admin, { ...mismosPasos(e.f, ""), archivos: ["modelo", "plano"] });
  const archivoDe = async (fileId: string) => (await listarArchivos(e.admin)).archivos.find((x) => x.fileId === fileId)!;
  const decide = async (quien: string, fileId: string, d: "aprobar" | "rechazar", texto = "") => {
    const x = await archivoDe(fileId);
    await decidir(e.ctx(quien), { archivoId: x.id, versionId: x.versionId, texto }, d);
  };
  const cierres = async () => (await estado(e.admin)).cierres;
  await decide("luz", "modelo", "aprobar");
  await decide("pepe", "modelo", "aprobar");
  assert.deepEqual(await cierres(), {}, "plano.pdf still waits");
  await decide("luz", "plano", "rechazar", "Faltan cotas");
  assert.deepEqual(await cierres(), {}, "a rejection doesn't close it");
  // The corrected plan enters by reactivating the flow and goes through both steps.
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 1), e.archivo("plano", "plano.pdf", 2)];
  await revisarFlujo(e.ctx("juan"), { flujoId: e.f.id });
  st = await estado(e.admin);
  await reactivarFlujo(e.admin, { id: st.flujos[0].id, version: st.flujos[0].version });
  await decide("luz", "plano", "aprobar");
  assert.deepEqual(await cierres(), {});
  await decide("pepe", "plano", "aprobar", "Cumple");
  assert.equal((await cierres())[e.f.id]?.quien, "Pepe", "the last file approved closes it");
  // A newer version brought in by reactivating opens it again: there is something to decide.
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2), e.archivo("plano", "plano.pdf", 2)];
  await revisarFlujo(e.ctx("juan"), { flujoId: e.f.id });
  st = await estado(e.admin);
  await reactivarFlujo(e.admin, { id: st.flujos[0].id, version: st.flujos[0].version });
  assert.deepEqual(await cierres(), {});
});

test("un flujo desactivado con todo aprobado no se vuelve a activar; con un paso decidido sí", async () => {
  const e = await escenario();
  let st = await cambiarEstado(e.admin, { id: e.f.id, version: e.f.version, activo: false });
  assert.equal(st.flujos[0].activo, false, "without decisions it can be deactivated");
  let a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  st = await cambiarEstado(e.admin, { id: st.flujos[0].id, version: st.flujos[0].version, activo: true });
  assert.equal(st.flujos[0].activo, true, "a step decided: still open");
  st = await cambiarEstado(e.admin, { id: st.flujos[0].id, version: st.flujos[0].version, activo: false });
  a = await e.modelo();
  await decidir(e.ctx("pepe"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  const f = (await estado(e.admin)).flujos[0];
  await assert.rejects(() => cambiarEstado(e.admin, { id: f.id, version: f.version, activo: true }), cerrado);
});
