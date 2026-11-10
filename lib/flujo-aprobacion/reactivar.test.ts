import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
import { reactivarFlujo } from "./reactivar";
import { listarArchivos, revisarFlujo } from "./revision";
import { cambiarEstado, Ctx, estado, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("deivis", "Deivis")];

/** modelo.rvt uploaded by Juan; a flow made by Deivis (not an administrator): Revisa = Luz, Aprueba = Pepe. */
async function escenario(o: { cierre?: (todoId: string, cuerpo: Record<string, unknown>) => { estado: number; cuerpo: unknown } } = {}) {
  const store = memoryStore();
  const arbol: Record<string, RawFolderItem[]> = {};
  const archivo = (revision: number, quien = "juan"): RawFolderItem => ({
    id: "modelo",
    name: "modelo.rvt",
    type: "FILE",
    createdOn: "",
    modifiedOn: `2026-11-0${revision}T15:00:00.000Z`,
    modifiedBy: { id: quien, firstName: PERSONAS.find((p) => p.id === quien)!.firstName },
    versionId: `modelo-v${revision}`,
    revision,
  });
  arbol.arq = [archivo(1)];
  const tareas: Record<string, unknown>[] = [];
  const cerradas: { id: string; cuerpo: Record<string, unknown> }[] = [];
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => PERSONAS,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => arbol[id] ?? [],
    version: async () => arbol.arq[0].versionId ?? null,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
    crearTarea: async (cuerpo) => {
      tareas.push(cuerpo);
      return { estado: 201, cuerpo: { id: `todo${tareas.length}` } };
    },
    actualizarTarea: async (id, cuerpo) => {
      cerradas.push({ id, cuerpo });
      return o.cierre?.(id, cuerpo) ?? { estado: 200, cuerpo: { id, status: cuerpo.status } };
    },
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store,
    tc,
    ahora: () => new Date("2026-11-10T22:00:00Z"),
  });
  const creador = ctx("deivis");
  const f = (
    await guardarFlujo(creador, {
      hito: "aprobar torre 2",
      archivos: ["modelo"],
      pasos: [
        { nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } },
        { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
      ],
    })
  ).flujos[0];
  const modelo = async () => (await listarArchivos(creador)).archivos.find((a) => a.fileId === "modelo")!;
  const decide = async (quien: string, d: "aprobar" | "rechazar", texto = "") => {
    const a = await modelo();
    return decidir(ctx(quien), { archivoId: a.id, versionId: a.versionId, texto }, d);
  };
  const subir = async (revision: number) => {
    arbol.arq = [archivo(revision, "pepe")];
    await revisarFlujo(creador, { flujoId: f.id });
  };
  const flujo = async () => (await estado(creador)).flujos[0];
  return { store, tareas, cerradas, ctx, creador, f, modelo, decide, subir, flujo };
}

test("cada paso decidido cierra su tarea de Trimble; un rechazo deja una tarea de corrección abierta", async () => {
  const e = await escenario();
  assert.deepEqual((await e.modelo()).tareas?.map((t) => [t.id, t.tipo, t.pasoId, t.versionId]), [["todo1", "revision", "p1", "modelo-v1"]]);
  await e.decide("luz", "aprobar");
  assert.deepEqual(e.cerradas, [{ id: "todo1", cuerpo: { status: "CLOSED" } }], "Luz's ToDo for «Revisa»");
  let a = await e.modelo();
  assert.deepEqual(
    a.tareas?.map((t) => [t.id, t.pasoId, t.cerrada ?? null, t.cierre ?? null]),
    [
      ["todo1", "p1", "2026-11-10T22:00:00.000Z", "CLOSED"],
      ["todo2", "p2", null, null],
    ]
  );
  await e.decide("pepe", "rechazar", "Faltan los ejes");
  assert.deepEqual(
    e.cerradas.map((c) => c.id),
    ["todo1", "todo2"],
    "Pepe's ToDo for «Aprueba» is closed when he decides"
  );
  a = await e.modelo();
  assert.deepEqual(a.tareas?.find((t) => t.id === "todo3")?.tipo, "correccion", "the ToDo to Juan to correct it stays open");
  const h = (await historial(e.creador, null, a.id)).entradas.filter((x) => x.accion === "tarea-cerrada").map((x) => x.detalle);
  assert.equal(h.length, 2);
  assert.match(h[0], /^Cerró la tarea de Trimble «Revisar: modelo.rvt \(Aprueba\) — aprobar torre 2»: Trimble la dejó en estado CLOSED\.$/);
});

test("si Trimble no deja cerrar la tarea, la decisión vale igual y queda anotado en el historial", async () => {
  const e = await escenario({ cierre: () => ({ estado: 403, cuerpo: "Forbidden" }) });
  const r = await e.decide("luz", "aprobar");
  assert.match(r.mensaje, /pasa a «Aprueba»/);
  const a = await e.modelo();
  assert.equal(a.pasoNombre, "Aprueba");
  assert.equal(a.tareas?.[0].cerrada ?? null, null);
  assert.match(a.tareas?.[0].cierre ?? "", /Trimble no la cerró \(403\)/);
  assert.ok((await historial(e.creador, null, a.id)).entradas.some((x) => x.accion === "tarea-no-cerrada" && /No se pudo cerrar la tarea de Trimble «Revisar: modelo.rvt \(Revisa\)/.test(x.detalle)));
});

test("reactivar: solo con una versión nueva, por quien creó el flujo; entra la nueva desde el primer paso y queda todo en el historial", async () => {
  const e = await escenario();
  await e.decide("luz", "aprobar");
  await e.decide("pepe", "aprobar", "Cumple");
  let f = await e.flujo();
  await assert.rejects(() => reactivarFlujo(e.creador, { id: f.id, version: f.version }), (err: unknown) => err instanceof FlujoError && err.code === "sin-version-nueva");
  await e.subir(2);
  assert.equal((await e.modelo()).estado, "aprobado", "a newer version is only noted");
  f = await e.flujo();
  await assert.rejects(() => reactivarFlujo(e.ctx("luz"), { id: f.id, version: f.version }), /Solo quien creó este flujo \(Deivis\) o un administrador del proyecto en Trimble puede reactivarlo/);
  const tareasAntes = e.tareas.length;
  const r = await reactivarFlujo(e.creador, { id: f.id, version: f.version });
  assert.match(r.mensaje!, /^Se reactivó «aprobar torre 2»: «modelo.rvt» versión 2 entra a revisión desde el primer paso\. Se avisó con 1 tarea de Trimble\.$/);
  const a = await e.modelo();
  assert.equal(a.estado, "nueva-version");
  assert.equal(a.revision, 2);
  assert.equal(a.subidoPor, "Pepe");
  assert.equal(a.pasoNombre, "Revisa");
  assert.deepEqual(a.firmas, [], "a new review of version 2");
  assert.equal(a.revisionAprobada, 1, "version 1 stays as the approved one");
  assert.equal(a.versionNueva ?? null, null);
  assert.equal(e.tareas.length, tareasAntes + 1, "Luz gets the ToDo for version 2");
  const h = (await historial(e.creador, f.id)).entradas;
  assert.match(h.find((x) => x.accion === "flujo-reactivado")!.detalle, /^Reactivó «aprobar torre 2»: entra «modelo.rvt» versión 2\. Se revisan desde el primer paso; lo decidido antes queda en el historial\.$/);
  assert.match(h.find((x) => x.accion === "version-reactivada")!.detalle, /^Entra la versión 2 \(subida por Pepe el .+\) al reactivar el flujo «aprobar torre 2»: se revisa desde el primer paso; la versión 1 quedó aprobada\.$/);
  for (const accion of ["aprobado-paso", "aprobado", "version-nueva-vista"]) assert.ok(h.some((x) => x.accion === accion), `the history keeps «${accion}»`);
  // It is still closed for editing, and version 2 goes through the steps again.
  const cerrado = await e.flujo();
  await assert.rejects(() => cambiarEstado(e.creador, { id: cerrado.id, version: cerrado.version, activo: false }), (err: unknown) => err instanceof FlujoError && err.code === "flujo-cerrado");
  await e.decide("luz", "aprobar");
  assert.equal((await e.modelo()).pasoNombre, "Aprueba");
});

test("reactivar un rechazado: entra la versión corregida y se cierra la tarea de corrección", async () => {
  const e = await escenario();
  await e.decide("luz", "rechazar", "Faltan los ejes");
  const correccion = (await e.modelo()).tareas!.find((t) => t.tipo === "correccion")!;
  await e.subir(2);
  const f = await e.flujo();
  await reactivarFlujo(e.creador, { id: f.id, version: f.version });
  assert.ok(e.cerradas.some((c) => c.id === correccion.id), "the ToDo to correct it is done");
  const a = await e.modelo();
  assert.equal(a.estado, "nueva-version");
  assert.match((await historial(e.creador, null, a.id)).entradas.find((x) => x.accion === "version-reactivada")!.detalle, /la versión 1 quedó rechazada\.$/);
});

test("reactivar un flujo desactivado lo deja activo; lo que esperaba decisión pasa a la versión nueva y su tarea se cierra", async () => {
  const e = await escenario();
  await e.subir(2);
  let f = await e.flujo();
  await cambiarEstado(e.creador, { id: f.id, version: f.version, activo: false });
  f = await e.flujo();
  const r = await reactivarFlujo(e.ctx("ana", true), { id: f.id, version: f.version });
  assert.match(r.mensaje!, /\(estaba desactivado: queda activo\)/);
  assert.equal((await e.flujo()).activo, true);
  const a = await e.modelo();
  assert.equal(a.revision, 2);
  assert.ok(e.cerradas.some((c) => c.id === "todo1"), "the ToDo for version 1 is closed: it won't be decided");
  assert.match((await historial(e.creador, null, a.id)).entradas.find((x) => x.accion === "version-reactivada")!.detalle, /la versión 1 no se decidió\.$/);
});
