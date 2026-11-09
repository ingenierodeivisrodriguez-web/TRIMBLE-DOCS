import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { FlujoError } from "./errores";
import { listarArchivos, revisarFlujo } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";

// Obra > Arquitectura > {modelo.rvt, Torre 1 > detalle.dwg, Fachada > fachada.pdf}
const RUTAS: Record<string, { ruta: string; ancestros: string[] }> = {
  arq: { ruta: "Obra / Arquitectura", ancestros: ["raiz"] },
  t1: { ruta: "Obra / Arquitectura / Torre 1", ancestros: ["raiz", "arq"] },
  fach: { ruta: "Obra / Arquitectura / Fachada", ancestros: ["raiz", "arq"] },
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
  const sinPermiso = new Set<string>();
  const tareas: Record<string, unknown>[] = [];
  const tc: TrimbleFlujo = {
    async carpeta() {
      throw new FlujoError("No se usa.", 500);
    },
    async archivo(id) {
      if (borrados.has(id)) throw new FlujoError("No existe o no tienes acceso en Trimble Connect.", 404);
      if (sinPermiso.has(id)) throw new FlujoError("Trimble Connect negó el acceso con tu usuario.", 403);
      for (const [c, items] of Object.entries(arbol)) {
        const it = items.find((x) => x.id === id);
        if (it) return { id, ruta: `${RUTAS[c].ruta} / ${it.name}`, ancestros: [...RUTAS[c].ancestros, c] };
      }
      throw new FlujoError("No existe o no tienes acceso en Trimble Connect.", 404);
    },
    personas: async () => PERSONAS,
    grupos: async () => [{ id: "g-arq", name: "Arquitectura" }],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => (arbol[id] ? arbol[id] : Promise.reject(new Error("403"))),
    version: async (id) => Object.values(arbol).flat().find((x) => x.id === id)?.versionId ?? null,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
    crearTarea: async (cuerpo) => {
      tareas.push(cuerpo);
      return { estado: 201, cuerpo: { id: `todo${tareas.length}` } };
    },
  };
  const caller = (id: string, isAdmin: boolean, grupos: string[] = []): Caller => ({ id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async (ids) => new Set(ids.filter((g) => grupos.includes(g))) });
  const ctx = (c: Caller): Ctx => ({ projectId: "P", caller: c, store, tc, ahora: () => new Date("2026-11-09T20:00:00Z") });
  const admin = ctx(caller("ana", true));
  return { store, arbol, archivo, borrados, sinPermiso, tareas, admin, como: (id: string, grupos: string[] = []) => ctx(caller(id, false, grupos)) };
}

async function conFlujo(e: ReturnType<typeof escenario>, archivos = ["modelo", "detalle", "fachada"]) {
  const r = await guardarFlujo(e.admin, {
    hito: "Aprobar arquitectura Torre 1",
    archivos,
    pasos: [
      { nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq" } },
      { nombre: "Aprueba", responsable: { tipo: "persona", id: "ana" } },
    ],
  });
  return { f: r.flujos[0], mensaje: r.mensaje };
}

test("al guardar el flujo sus archivos quedan pendientes, con quién los subió y cuándo; revisar otra vez no cambia nada", async () => {
  const e = escenario();
  const { f, mensaje } = await conFlujo(e);
  assert.match(mensaje!, /^«Aprobar arquitectura Torre 1»: 3 archivos nuevos\./);
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
  assert.match(linea.detalle, /^Subió la versión 1 el 01-11-2026 10:00 en Obra \/ Arquitectura \/ modelo.rvt\. Pendiente de revisión: Revisa\. Lo registró Ana en el flujo\./);
  const otra = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(otra.mensaje, "«Aprobar arquitectura Torre 1»: sin cambios.");
  assert.equal(otra.sinCambios, 3);
  assert.equal(otra.completo, true);
  assert.equal((await e.store.flujo(f.id))?.revisadoPor, "Ana");
});

test("solo entran los archivos elegidos: uno nuevo en la misma carpeta no entra solo", async () => {
  const e = escenario();
  const { f } = await conFlujo(e, ["modelo"]);
  e.arbol.arq.push(e.archivo("nuevo", "nuevo.rvt", 1));
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: sin cambios.");
  assert.deepEqual(
    (await e.store.archivos("P")).map((a) => a.fileId),
    ["modelo"]
  );
});

test("una versión nueva mientras espera queda anotada con quien la subió y se revisa desde el primer paso", async () => {
  const e = escenario();
  const { f } = await conFlujo(e);
  e.arbol.arq[0] = e.archivo("modelo", "modelo.rvt", 2, PERSONAS[2]);
  const r = await revisarFlujo(e.como("juan"), { flujoId: f.id });
  assert.match(r.mensaje, /^«Aprobar arquitectura Torre 1»: 1 versión nueva\./);
  const a = (await e.store.archivos("P")).find((x) => x.fileId === "modelo")!;
  assert.equal(a.revision, 2);
  assert.equal(a.estado, "pendiente");
  assert.equal(a.subidoPor, "Pepe Gómez");
  const linea = (await historial(e.admin, null, a.id)).entradas.find((x) => x.accion === "version-reemplazada")!;
  assert.equal(linea.usuario, "Pepe Gómez");
  assert.equal(linea.version, 2);
});

test("un archivo que se mueve de carpeta se sigue: solo cambia su ruta", async () => {
  const e = escenario();
  const { f } = await conFlujo(e);
  e.arbol.arq = e.arbol.arq.filter((x) => x.id !== "modelo");
  e.arbol.fach.push(e.archivo("modelo", "modelo.rvt", 1));
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: sin cambios.");
  const a = (await e.store.archivos("P")).find((x) => x.fileId === "modelo")!;
  assert.equal(a.ruta, "Obra / Arquitectura / Fachada / modelo.rvt");
  assert.equal(a.estado, "pendiente");
});

test("un archivo que Trimble ya no tiene solo se retira en la revisión de un administrador; si vuelve, recupera su estado", async () => {
  const e = escenario();
  const { f } = await conFlujo(e);
  e.arbol.arq = e.arbol.arq.filter((x) => x.id !== "modelo");
  e.borrados.add("modelo");

  // A member's review doesn't retire.
  const miembro = await revisarFlujo(e.como("juan"), { flujoId: f.id });
  assert.match(miembro.mensaje, /1 archivo registrado no apareció en tu revisión; solo la de un administrador lo/);
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");

  // A file that can't be read (no access) leaves it incomplete and is not retired.
  e.borrados.delete("modelo");
  e.sinPermiso.add("modelo");
  const incompleta = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.match(incompleta.mensaje, /Revisión incompleta \(no se pudo leer «Obra \/ Arquitectura \/ modelo.rvt»\)/);
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");
  e.sinPermiso.delete("modelo");
  e.borrados.add("modelo");

  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.mensaje, "«Aprobar arquitectura Torre 1»: 1 retirado.");
  const a = (await e.store.archivos("P")).find((x) => x.fileId === "modelo")!;
  assert.equal(a.estado, "retirado");
  assert.match((await historial(e.admin, null, a.id)).entradas[0].detalle, /Ya no está en Trimble .* Queda como retirado; no se borra nada\./);

  // It comes back (restored in Trimble).
  e.borrados.delete("modelo");
  e.arbol.arq.push(e.archivo("modelo", "modelo.rvt", 1));
  const vuelve = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(vuelve.mensaje, "«Aprobar arquitectura Torre 1»: 1 archivo que vuelve.");
  assert.equal((await e.store.archivos("P")).find((x) => x.fileId === "modelo")?.estado, "pendiente");
});

test("dos revisiones del mismo flujo a la vez: la segunda no registra nada", async () => {
  const e = escenario();
  const { f } = await conFlujo(e, ["modelo"]);
  e.arbol.arq[0] = e.archivo("modelo", "modelo.rvt", 2);
  await e.store.tomarRevision(f.id, "2026-11-09T20:03:00.000Z", "2026-11-09T20:00:00.000Z");
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.equal(r.ocupado, true);
  assert.match(r.mensaje, /Otra persona está revisando/);
  assert.equal((await e.store.archivos("P"))[0].revision, 1);
});

test("cada archivo dice qué paso espera, quién es su responsable y si me toca; a quien lo subió no le toca", async () => {
  const e = escenario();
  await conFlujo(e);
  const deJuan = await listarArchivos(e.como("juan", ["g-arq"]));
  const modelo = deJuan.archivos.find((a) => a.fileId === "modelo")!;
  assert.equal(modelo.pasoNombre, "Revisa");
  assert.deepEqual(modelo.responsables, ["Arquitectura (grupo)"]);
  assert.equal(modelo.meToca, false, "Juan uploaded it");
  assert.equal(modelo.hito, "Aprobar arquitectura Torre 1");
  assert.equal(modelo.destino, null);
  assert.match(modelo.enlace, /\/projects\/P\/viewer\/3d\?modelId=modelo&versionId=modelo-v1/);
  const dePepe = await listarArchivos(e.como("pepe", ["g-arq"]));
  assert.equal(dePepe.archivos.find((a) => a.fileId === "modelo")?.meToca, true);
  const sinGrupo = await listarArchivos(e.como("pepe"));
  assert.equal(sinGrupo.archivos.find((a) => a.fileId === "modelo")?.meToca, false);
});

test("un flujo desactivado no se revisa", async () => {
  const e = escenario();
  const { f } = await conFlujo(e, ["modelo"]);
  const { cambiarEstado } = await import("./service");
  await cambiarEstado(e.admin, { id: f.id, version: f.version, activo: false });
  e.arbol.arq[0] = e.archivo("modelo", "modelo.rvt", 2);
  const r = await revisarFlujo(e.admin, { flujoId: f.id });
  assert.match(r.mensaje, /está desactivado/);
  assert.equal((await e.store.archivos("P"))[0].revision, 1);
});
