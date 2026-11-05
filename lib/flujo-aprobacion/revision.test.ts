import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { FlujoError } from "./errores";
import { listarArchivos, revisarFlujo } from "./revision";
import { agregarAsignaciones, Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import type { CarpetaFlujo } from "./types";

// Obra > Arquitectura > {modelo.rvt, Torre 1 > detalle.dwg, Fachada (another flow) > fachada.pdf}; Obra > Aprobados
const CARPETAS: Record<string, CarpetaFlujo> = {
  arq: { id: "arq", ruta: "Obra / Arquitectura", ancestros: ["raiz"] },
  fach: { id: "fach", ruta: "Obra / Arquitectura / Fachada", ancestros: ["raiz", "arq"] },
  apr: { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] },
  apr2: { id: "apr2", ruta: "Obra / Aprobados 2", ancestros: ["raiz"] },
};
const persona = (id: string, firstName: string, lastName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName, email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "Ruiz", "ADMIN"), persona("juan", "Juan", "Pérez"), persona("pepe", "Pepe", "Gómez")];

function escenario() {
  const store = memoryStore();
  // The folders Trimble has right now; tests change them.
  const arbol: Record<string, RawFolderItem[]> = {};
  const archivo = (id: string, name: string, revision: number, quien = PERSONAS[1]): RawFolderItem => ({
    id,
    name,
    type: "FILE",
    createdOn: "2026-10-01T15:00:00.000Z",
    modifiedOn: `2026-11-0${Math.min(revision, 9)}T15:00:00.000Z`,
    createdBy: { id: "ana", firstName: "Ana", lastName: "Ruiz" },
    modifiedBy: { id: quien.id, firstName: quien.firstName, lastName: quien.lastName },
    versionId: `${id}-v${revision}`,
    revision,
  });
  const carpeta = (id: string, name: string): RawFolderItem => ({ id, name, type: "FOLDER", createdOn: "", modifiedOn: "" });
  arbol.arq = [archivo("modelo", "modelo.rvt", 1), carpeta("t1", "Torre 1"), carpeta("fach", "Fachada")];
  arbol.t1 = [archivo("detalle", "detalle.dwg", 2)];
  arbol.fach = [archivo("fachada", "fachada.pdf", 1)];
  const borrados = new Set<string>();
  const tareas: Record<string, unknown>[] = [];
  const tc: TrimbleFlujo = {
    async carpeta(id) {
      if (!CARPETAS[id]) throw new FlujoError("No existe.", 404);
      return CARPETAS[id];
    },
    async archivo(id) {
      if (borrados.has(id)) throw new FlujoError("No existe o no tienes acceso en Trimble Connect.", 404);
      for (const [c, items] of Object.entries(arbol)) if (items.some((x) => x.id === id)) return { id, ruta: `… / ${id}`, ancestros: c === "t1" ? ["raiz", "arq", "t1"] : ["raiz", c] };
      return { id, ruta: `Obra / Otra / ${id}`, ancestros: ["raiz", "otra"] };
    },
    personas: async () => PERSONAS,
    grupos: async () => [{ id: "g-arq", name: "Arquitectura" }],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => (arbol[id] ? arbol[id] : Promise.reject(new Error("403"))),
    version: async (id) => Object.values(arbol).flat().find((x) => x.id === id)?.versionId ?? null,
    crearTarea: async (cuerpo) => {
      tareas.push(cuerpo);
      return { estado: 201, cuerpo: { id: `todo${tareas.length}` } };
    },
  };
  const caller = (id: string, isAdmin: boolean, grupos: string[] = []): Caller => ({ id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async (ids) => new Set(ids.filter((g) => grupos.includes(g))) });
  const ctx = (c: Caller): Ctx => ({ projectId: "P", caller: c, store, tc, ahora: () => new Date("2026-11-04T20:00:00Z") });
  const admin = ctx(caller("ana", true));
  return { store, arbol, archivo, borrados, tareas, admin, como: (id: string, grupos: string[] = []) => ctx(caller(id, false, grupos)) };
}

async function conFlujo(e: ReturnType<typeof escenario>) {
  const f = (await guardarFlujo(e.admin, { hito: "Aprobar arquitectura Torre 1", carpetas: ["arq"], destino: "apr", pasos: [{ nombre: "Revisa" }, { nombre: "Aprueba" }] })).flujos[0];
  return f;
}

test("al revisar se registran los archivos de las carpetas y subcarpetas como pendientes, con quién los subió; la segunda vez no cambia nada", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: 3 archivos nuevos.");
  assert.equal(r.completo, true);
  const archivos = await e.store.archivos("P");
  assert.deepEqual(
    archivos.map((a) => [a.ruta, a.estado, a.revision, a.subidoPor, a.tipo]),
    [
      ["Obra / Arquitectura / Fachada / fachada.pdf", "pendiente", 1, "Juan Pérez", "pdf"],
      ["Obra / Arquitectura / modelo.rvt", "pendiente", 1, "Juan Pérez", "rvt"],
      ["Obra / Arquitectura / Torre 1 / detalle.dwg", "pendiente", 2, "Juan Pérez", "dwg"],
    ]
  );
  const h = await historial(e.admin, f.id);
  assert.equal(h.entradas.filter((x) => x.accion === "archivo-detectado").length, 3);
  const linea = h.entradas.find((x) => x.fileId === "modelo")!;
  assert.equal(linea.usuario, "Juan Pérez");
  assert.equal(linea.ocurrido, "2026-11-01T15:00:00.000Z");
  assert.match(linea.detalle, /^Subió la versión 1 el 01-11-2026 10:00 en Obra \/ Arquitectura \/ modelo.rvt\. Pendiente de revisión: Revisa\./);
  const otra = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(otra.mensaje, "«Aprobar arquitectura Torre 1»: sin cambios.");
  assert.equal(otra.sinCambios, 3);
  assert.equal((await e.store.flujo(f.id))?.revisadoPor, "Ana");
});

test("una subcarpeta que es de otro flujo se deja a ese flujo", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  await guardarFlujo(e.admin, { hito: "Aprobar fachada", carpetas: ["fach"], destino: "apr2", pasos: [{ nombre: "Aprueba" }] });
  await revisarFlujo(e.admin, { flujoId: f.id });
  assert.deepEqual(
    (await e.store.archivos("P")).map((a) => a.fileId),
    ["modelo", "detalle"]
  );
});

test("una versión nueva mientras espera queda anotada con quien la subió y se revisa desde el primer paso", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  await revisarFlujo(e.admin, { flujoId: f.id });
  e.arbol.arq[0] = e.archivo("modelo", "modelo.rvt", 2, PERSONAS[2]);
  const r = await revisarFlujo(e.como("juan"), { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: 1 versión nueva.");
  const a = (await e.store.archivos("P")).find((x) => x.fileId === "modelo")!;
  assert.equal(a.revision, 2);
  assert.equal(a.estado, "pendiente");
  assert.equal(a.subidoPor, "Pepe Gómez");
  const linea = (await historial(e.admin, null, a.id)).entradas[0];
  assert.equal(linea.accion, "version-reemplazada");
  assert.equal(linea.usuario, "Pepe Gómez");
  assert.equal(linea.version, 2);
});

test("un archivo que ya no aparece solo se retira con la revisión completa de un administrador y si Trimble lo confirma", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  await revisarFlujo(e.admin, { flujoId: f.id });
  e.arbol.arq = e.arbol.arq.filter((x) => x.id !== "modelo");
  e.borrados.add("modelo");

  // A member's review doesn't retire.
  const miembro = await revisarFlujo(e.como("juan"), { flujoId: f.id });
  assert.match(miembro.mensaje, /1 archivo registrado no apareció en tu revisión; solo la de un administrador lo/);
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");

  // An incomplete review doesn't either.
  const sinT1 = e.arbol.t1;
  delete e.arbol.t1;
  const incompleta = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.match(incompleta.mensaje, /Revisión incompleta \(no se pudo leer «Obra \/ Arquitectura \/ Torre 1»\)/);
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");
  e.arbol.t1 = sinT1;

  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: 1 retirado.");
  const a = (await e.store.archivos("P")).find((x) => x.fileId === "modelo")!;
  assert.equal(a.estado, "retirado");
  assert.match((await historial(e.admin, null, a.id)).entradas[0].detalle, /Ya no está en Trimble .* Queda como retirado; no se borra nada\./);

  // It comes back.
  e.arbol.arq.push(e.archivo("modelo", "modelo.rvt", 1));
  const vuelve = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(vuelve.mensaje, "«Aprobar arquitectura Torre 1»: 1 archivo que vuelve.");
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");
});

test("dos revisiones del mismo flujo a la vez: la segunda no registra nada", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  await e.store.tomarRevision(f.id, "2026-11-04T20:03:00.000Z", "2026-11-04T20:00:00.000Z");
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.ocupado, true);
  assert.match(r.mensaje, /Otra persona está revisando/);
  assert.equal((await e.store.archivos("P")).length, 0);
});

test("cada archivo dice qué paso espera, quién lo tiene y si me toca; a quien lo subió no le toca", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  await agregarAsignaciones(e.admin, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "grupo", id: "g-arq" }, papel: "p1" });
  await revisarFlujo(e.admin, { flujoId: f.id });
  const deJuan = await listarArchivos(e.como("juan", ["g-arq"]));
  const modelo = deJuan.archivos.find((a) => a.fileId === "modelo")!;
  assert.equal(modelo.pasoNombre, "Revisa");
  assert.deepEqual(modelo.responsables, ["Arquitectura (grupo)"]);
  assert.equal(modelo.meToca, false, "Juan uploaded it");
  assert.equal(modelo.hito, "Aprobar arquitectura Torre 1");
  assert.match(modelo.enlace, /\/projects\/P\/viewer\/3d\?modelId=modelo&versionId=modelo-v1/);
  const dePepe = await listarArchivos(e.como("pepe", ["g-arq"]));
  assert.equal(dePepe.archivos.find((a) => a.fileId === "modelo")?.meToca, true);
  const sinGrupo = await listarArchivos(e.como("pepe"));
  assert.equal(sinGrupo.archivos.find((a) => a.fileId === "modelo")?.meToca, false);
});

test("un flujo desactivado no se revisa", async () => {
  const e = escenario();
  const f = await conFlujo(e);
  const { cambiarEstado } = await import("./service");
  await cambiarEstado(e.admin, { id: f.id, version: f.version, activo: false });
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.match(r.mensaje, /está desactivado/);
  assert.equal((await e.store.archivos("P")).length, 0);
});
