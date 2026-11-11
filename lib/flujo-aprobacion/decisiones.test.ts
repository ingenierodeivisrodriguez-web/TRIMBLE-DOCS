import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
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
  const tareas: Record<string, unknown>[] = [];
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
    crearTarea: async (cuerpo) => {
      tareas.push(cuerpo);
      return { estado: 201, cuerpo: { id: `todo${tareas.length}` } };
    },
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async (ids) => new Set(ids.filter((g) => g === "g-arq" && (id === "luz" || id === "eva"))) } satisfies Caller,
    store,
    tc,
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
  return { store, arbol, archivo, tareas, ctx, admin, f, registro, modelo };
}

test("al registrar un archivo nuevo se avisa con una tarea de Trimble a quien tiene el primer paso", async () => {
  const e = await escenario();
  assert.match(e.registro.mensaje, /1 archivo nuevo\. Se avisó a los revisores con 1 tarea de Trimble\./);
  assert.equal(e.tareas.length, 1);
  // The ToDo shows the flow's code, title and description (its title again: it has none), with the type «Flujo de aprobación».
  assert.deepEqual(e.tareas[0], { projectId: "P", label: "FLUJO-01", title: "Aprobar Torre 1", description: "Aprobar Torre 1", assignees: [{ id: "g-arq", type: "GROUP" }], type: "Flujo de aprobación" });
  const h = await historial(e.admin, e.f.id);
  assert.ok(h.entradas.some((x) => x.accion === "aviso-enviado" && /^Tarea de Trimble FLUJO-01 para Arquitectura \(grupo\): «Revisar: modelo.rvt \(Revisa\) — Aprobar Torre 1»\.$/.test(x.detalle)));
});

test("paso a paso: alguien del grupo revisa, Pepe aprueba; queda aprobada esa versión con sus firmas", async () => {
  const e = await escenario();
  let a = await e.modelo();
  const r1 = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  assert.equal(r1.mensaje, "Aprobaste «Revisa» de «modelo.rvt»: pasa a «Aprueba».");
  assert.match(r1.aviso!, /Tarea de Trimble FLUJO-01 para Pepe/);
  assert.deepEqual(e.tareas[1].assignees, [{ id: "pepe", type: "USER" }]);
  a = await e.modelo();
  assert.equal(a.pasoNombre, "Aprueba");
  // Eva (same group) can't approve a step that is no longer hers.
  await assert.rejects(() => decidir(e.ctx("eva"), { archivoId: a.id, versionId: a.versionId }, "aprobar"), /El paso «Aprueba» de este archivo no es tuyo: lo tiene Pepe/);
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
  assert.match(r.aviso!, /Tarea de Trimble FLUJO-01 para Juan: «Corregir: modelo.rvt \(rechazado\) — Aprobar Torre 1»/);
  assert.deepEqual(e.tareas[1].assignees, [{ id: "juan", type: "USER" }]);
  assert.equal(e.tareas[1].title, "Aprobar Torre 1", "only the flow's title: the reason is seen in the extension");
  a = await e.modelo();
  assert.equal(a.estado, "rechazado");
  assert.equal(a.firmas[0].comentario, "Faltan los ejes");

  // The corrected version doesn't enter this flow by itself (10-11-2026): it is only noted.
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  const otra = await revisarFlujo(e.ctx("juan"), { flujoId: e.f.id });
  assert.match(otra.mensaje, /1 versión nueva en Trimble/);
  a = await e.modelo();
  assert.equal(a.estado, "rechazado");
  assert.equal(a.revision, 1);
  assert.equal(a.versionNueva?.revision, 2);
  assert.equal(a.firmas.length, 1, "the rejection stays");
  assert.equal(e.tareas.length, 2, "no ToDo: nothing new to review in this flow");
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

test("quien subió la versión no decide, aunque sea administrador; un administrador sin el paso sí, y queda anotado", async () => {
  const e = await escenario();
  let a = await e.modelo();
  // The flow's version as uploaded by Ana, an administrator without the step.
  await e.store.actualizarArchivo(a.id, { subidoPor: "Ana", subidoPorId: "ana" });
  a = await e.modelo();
  await assert.rejects(() => decidir(e.admin, { archivoId: a.id, versionId: a.versionId }, "aprobar"), /Tú subiste esta versión/);
  await e.store.actualizarArchivo(a.id, { subidoPor: "Juan", subidoPorId: "juan" });
  a = await e.modelo();
  await assert.rejects(() => decidir(e.ctx("pepe"), { archivoId: a.id, versionId: a.versionId }, "aprobar"), /no es tuyo/);
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
const cerrado = (err: unknown) => err instanceof FlujoError && err.code === "flujo-cerrado" && err.status === 409 && /ya tiene decisiones \(la primera el \d\d-\d\d-\d{4}, de Luz\): el flujo quedó cerrado y no se puede editar, activar ni desactivar/.test(err.message);

test("después de la primera decisión el flujo queda cerrado: ni el creador ni un administrador lo editan o desactivan, y sigue revisando versiones nuevas", async () => {
  const e = await escenario();
  // Before any decision its creator (an administrator here) still changes it.
  const antes = await guardarFlujo(e.admin, mismosPasos(e.f, "2026-11-20"));
  assert.deepEqual(antes.cierres, {});
  const a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  const st = await estado(e.ctx("juan"));
  const f = st.flujos[0];
  assert.equal(st.cierres[f.id]?.quien, "Luz", "everyone sees it closed");
  await assert.rejects(() => guardarFlujo(e.admin, mismosPasos(f, "2026-11-30")), cerrado);
  await assert.rejects(() => cambiarEstado(e.admin, { id: f.id, version: f.version, activo: false }), cerrado);
  assert.equal((await estado(e.admin)).flujos[0].vence, "2026-11-20", "nothing changed");
  // A rejected or corrected document still goes through the same steps.
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  assert.match((await revisarFlujo(e.ctx("juan"), { flujoId: f.id })).mensaje, /1 versión nueva/);
});

test("un flujo desactivado que ya tiene una decisión no se vuelve a activar", async () => {
  const e = await escenario();
  const st = await cambiarEstado(e.admin, { id: e.f.id, version: e.f.version, activo: false });
  assert.equal(st.flujos[0].activo, false, "without decisions it can be deactivated");
  const a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  const f = (await estado(e.admin)).flujos[0];
  await assert.rejects(() => cambiarEstado(e.admin, { id: f.id, version: f.version, activo: true }), cerrado);
});
