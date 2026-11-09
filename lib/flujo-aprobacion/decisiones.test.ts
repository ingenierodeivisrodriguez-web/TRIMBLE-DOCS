import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
import { listarArchivos, revisarFlujo } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
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
  assert.equal(e.tareas[0].label, "Revisar: modelo.rvt (Revisa) — Aprobar Torre 1");
  assert.deepEqual(e.tareas[0].assignees, [{ id: "g-arq", type: "GROUP" }]);
  assert.match(String(e.tareas[0].description), /• modelo.rvt — versión 1: https:\/\/web.connect.trimble.com\/projects\/P\/viewer\/3d\?modelId=modelo&versionId=modelo-v1/);
  const h = await historial(e.admin, e.f.id);
  assert.ok(h.entradas.some((x) => x.accion === "aviso-enviado" && /Tarea de Trimble para Arquitectura \(grupo\)/.test(x.detalle)));
});

test("paso a paso: alguien del grupo revisa, Pepe aprueba; queda aprobada esa versión con sus firmas", async () => {
  const e = await escenario();
  let a = await e.modelo();
  const r1 = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  assert.equal(r1.mensaje, "Aprobaste «Revisa» de «modelo.rvt»: pasa a «Aprueba».");
  assert.match(r1.aviso!, /Tarea de Trimble para Pepe/);
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

test("rechazar exige motivo, avisa a quien subió y la corrección llega como nueva versión pendiente desde el primer paso", async () => {
  const e = await escenario();
  let a = await e.modelo();
  await assert.rejects(() => decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "rechazar"), /Escribe el motivo del rechazo/);
  const r = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "Faltan los ejes" }, "rechazar");
  assert.equal(r.mensaje, "«modelo.rvt» queda rechazado (versión 1).");
  assert.match(r.aviso!, /Tarea de Trimble para Juan: «Corregir: modelo.rvt \(rechazado\) — Aprobar Torre 1»/);
  assert.deepEqual(e.tareas[1].assignees, [{ id: "juan", type: "USER" }]);
  assert.match(String(e.tareas[1].description), /Motivo: Faltan los ejes/);
  a = await e.modelo();
  assert.equal(a.estado, "rechazado");
  assert.equal(a.firmas[0].comentario, "Faltan los ejes");

  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  const otra = await revisarFlujo(e.ctx("juan"), { flujoId: e.f.id });
  assert.match(otra.mensaje, /1 versión nueva/);
  a = await e.modelo();
  assert.equal(a.estado, "nueva-version");
  assert.equal(a.pasoNombre, "Revisa");
  assert.deepEqual(a.firmas, [], "a new review starts without signatures");
  assert.equal(e.tareas.length, 3, "the reviewers get a ToDo for the corrected version");
});

test("no se decide sobre una versión vieja: ni la del registro ni la que ya está en Trimble", async () => {
  const e = await escenario();
  const a = await e.modelo();
  await assert.rejects(
    () => decidir(e.ctx("luz"), { archivoId: a.id, versionId: "modelo-v0" }, "aprobar"),
    (err: unknown) => err instanceof FlujoError && err.code === "version-cambio"
  );
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2)];
  await assert.rejects(() => decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId }, "aprobar"), /En Trimble ya hay una versión más nueva de este archivo: pulsa «Revisar ahora»/);
  assert.equal((await e.modelo()).pasoActual, 0, "nothing changed");
});

test("quien subió la versión no decide, aunque sea administrador; un administrador sin el paso sí, y queda anotado", async () => {
  const e = await escenario();
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 2, "ana")];
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  let a = await e.modelo();
  await assert.rejects(() => decidir(e.admin, { archivoId: a.id, versionId: a.versionId }, "aprobar"), /Tú subiste esta versión/);
  e.arbol.arq = [e.archivo("modelo", "modelo.rvt", 3, "juan")];
  await revisarFlujo(e.admin, { flujoId: e.f.id });
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
