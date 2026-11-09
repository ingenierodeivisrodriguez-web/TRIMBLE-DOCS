import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { FolderPermissions, ProjectUser, RawFolderItem } from "../trimbleApi";
import { FlujoError } from "./errores";
import { listarArchivos } from "./revision";
import { cambiarEstado, Ctx, equipo, estado, guardarFlujo, historial, permisosFlujo, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import type { CarpetaFlujo } from "./types";

// Project "P": Obra > Diseño > {Arquitectura > {modelo.rvt, Torre 1 > detalle.dwg}, Estructura > E-101.pdf}
const ARCHIVOS: Record<string, CarpetaFlujo> = {
  modelo: { id: "modelo", ruta: "Obra / Diseño / Arquitectura / modelo.rvt", ancestros: ["raiz", "dis", "arq"] },
  detalle: { id: "detalle", ruta: "Obra / Diseño / Arquitectura / Torre 1 / detalle.dwg", ancestros: ["raiz", "dis", "arq", "t1"] },
  e101: { id: "e101", ruta: "Obra / Diseño / Estructura / E-101.pdf", ancestros: ["raiz", "dis", "est"] },
};
const persona = (id: string, firstName: string, lastName: string, extra: Partial<ProjectUser> = {}): ProjectUser => ({ id, firstName, lastName, email: `${id}@obra.co`, role: "USER", status: "ACTIVE", ...extra });
const PERSONAS = [persona("ana", "Ana", "Ruiz", { role: "ADMIN" }), persona("juan", "Juan", "Pérez"), persona("pepe", "Pepe", "Gómez"), persona("luz", "Luz", "Mora"), persona("ido", "Ido", "Ya", { status: "REMOVED" })];
const item = (id: string, name: string): RawFolderItem => ({
  id,
  name,
  type: "FILE",
  createdOn: "2026-11-01T15:00:00.000Z",
  modifiedOn: "2026-11-02T15:00:00.000Z",
  modifiedBy: { id: "luz", firstName: "Luz", lastName: "Mora" },
  versionId: `${id}-v1`,
  revision: 1,
});
const ARBOL: Record<string, RawFolderItem[]> = { arq: [item("modelo", "modelo.rvt")], t1: [item("detalle", "detalle.dwg")], est: [item("e101", "E-101.pdf")] };

function escenario(o: { permisos?: Record<string, FolderPermissions> } = {}) {
  const store = memoryStore();
  const tareas: Record<string, unknown>[] = [];
  const tc: TrimbleFlujo = {
    async carpeta() {
      throw new FlujoError("No se usa.", 500);
    },
    async archivo(id) {
      const a = ARCHIVOS[id];
      if (!a) throw new FlujoError("No existe o no tienes acceso en Trimble Connect.", 404);
      return a;
    },
    personas: async () => PERSONAS,
    grupos: async () => [{ id: "g-arq", name: "Arquitectura" }],
    miembros: async (g) => (g === "g-arq" ? [PERSONAS[1]] : []),
    permisos: async (id) => o.permisos?.[id] ?? { direct: { acl: {}, inheritance: true }, inherited: {} },
    items: async (id) => ARBOL[id] ?? [],
    version: async () => null,
    crearTarea: async (cuerpo) => {
      tareas.push(cuerpo);
      return { estado: 201, cuerpo: { id: "todo" } };
    },
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
  };
  const caller = (id: string, isAdmin = false): Caller => {
    const p = PERSONAS.find((x) => x.id === id)!;
    return { id, name: `${p.firstName} ${p.lastName}`, isAdmin, memberOfGroups: async () => new Set() };
  };
  const como = (id: string, isAdmin = false): Ctx => ({ projectId: "P", caller: caller(id, isAdmin), store, tc, ahora: () => new Date("2026-11-09T15:00:00Z") });
  return { store, tareas, admin: como("ana", true), juan: como("juan"), pepe: como("pepe"), como };
}

const RESP = { revisa: { tipo: "grupo", id: "g-arq" }, aprueba: { tipo: "persona", id: "pepe" } };
const nuevo = (extra: Record<string, unknown> = {}) => ({
  hito: "Aprobar diseño arquitectónico Torre 1",
  archivos: ["modelo", "detalle"],
  pasos: [
    { nombre: "Revisa", responsable: RESP.revisa },
    { nombre: "Aprueba", responsable: RESP.aprueba },
  ],
  ...extra,
});
const edicion = (f: { id: string; version: number; pasos: { id: string; nombre: string; responsable?: unknown }[] }, extra: Record<string, unknown> = {}) => ({ ...nuevo(), id: f.id, version: f.version, pasos: f.pasos, ...extra });

test("cualquier miembro crea un flujo con sus archivos y el responsable de cada paso; los nombres salen de Trimble y los archivos quedan registrados al momento", async () => {
  const e = escenario();
  const r = await guardarFlujo(e.juan, nuevo({ hito: "  Aprobar  diseño arquitectónico Torre 1 " }));
  assert.equal(r.esAdmin, false);
  const f = r.flujos[0];
  assert.equal(f.hito, "Aprobar diseño arquitectónico Torre 1");
  assert.equal(f.creadoPorId, "juan");
  assert.equal(f.destino, null);
  assert.deepEqual(f.pasos, [
    { id: "p1", nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq", nombre: "Arquitectura" } },
    { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe", nombre: "Pepe Gómez" } },
  ]);
  assert.deepEqual(f.archivos, [ARCHIVOS.modelo, ARCHIVOS.detalle]);
  assert.match(r.mensaje!, /^«Aprobar diseño arquitectónico Torre 1»: 2 archivos nuevos\. Se avisó a los revisores con 1 tarea de Trimble\./);
  assert.deepEqual(e.tareas[0].assignees, [{ id: "g-arq", type: "GROUP" }]);
  const registrados = (await listarArchivos(e.juan)).archivos;
  assert.deepEqual(
    registrados.map((a) => [a.nombre, a.estado, a.pasoNombre, a.responsables.join(", ")]),
    [
      ["modelo.rvt", "pendiente", "Revisa", "Arquitectura (grupo)"],
      ["detalle.dwg", "pendiente", "Revisa", "Arquitectura (grupo)"],
    ]
  );
  const h = await historial(e.juan, f.id);
  const creado = h.entradas.find((x) => x.accion === "flujo-creado")!;
  assert.equal(
    creado.detalle,
    "«Aprobar diseño arquitectónico Torre 1»: Realiza → Revisa → Aprueba. Responsables: Revisa: Arquitectura (grupo); Aprueba: Pepe Gómez. Archivos (2): modelo.rvt; detalle.dwg."
  );
  assert.equal(creado.usuario, "Juan Pérez");
});

test("cambia el flujo quien lo creó o un administrador; otro miembro no", async () => {
  const e = escenario();
  const f = (await guardarFlujo(e.juan, nuevo())).flujos[0];
  await assert.rejects(
    () => guardarFlujo(e.pepe, edicion(f, { hito: "Otro" })),
    (err: unknown) => err instanceof FlujoError && err.status === 403 && /Solo quien creó este flujo \(Juan Pérez\) o un administrador/.test(err.message)
  );
  await assert.rejects(() => cambiarEstado(e.pepe, { id: f.id, version: f.version, activo: false }), /Solo quien creó este flujo/);
  const porJuan = (await guardarFlujo(e.juan, edicion(f, { hito: "Aprobar arquitectura Torre 1" }))).flujos[0];
  const porAna = (await guardarFlujo(e.admin, edicion(porJuan, { hito: "Aprobar arquitectura Torre 1 (rev)" }))).flujos[0];
  assert.equal(porAna.hito, "Aprobar arquitectura Torre 1 (rev)");
  assert.equal(porAna.creadoPorId, "juan", "the creator stays");
});

test("cada paso necesita un responsable que esté en el equipo de Trimble", async () => {
  const e = escenario();
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ pasos: [{ nombre: "Aprueba" }] })), /Paso 2 \(«Aprueba»\): elige su responsable/);
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ pasos: [{ nombre: "Aprueba", responsable: { tipo: "persona", id: "ido" } }] })), /«Aprueba»: esa persona no está en el equipo del proyecto en Trimble/);
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ pasos: [{ nombre: "Aprueba", responsable: { tipo: "grupo", id: "g-x" } }] })), /ese grupo no existe en el proyecto/);
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ archivos: [] })), /Marca al menos un archivo/);
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ archivos: ["fantasma"] })), /No existe o no tienes acceso/);
});

test("el hito no se repite, aunque cambien tildes o mayúsculas", async () => {
  const e = escenario();
  await guardarFlujo(e.juan, nuevo());
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ hito: "APROBAR diseno arquitectonico torre 1", archivos: ["e101"] })), /Ya hay un flujo con ese título o hito/);
});

test("un archivo no puede estar en dos flujos activos; al desactivar uno queda libre, y no se reactiva si otro lo tomó", async () => {
  const e = escenario();
  const f = (await guardarFlujo(e.juan, nuevo())).flujos[0];
  await assert.rejects(
    () => guardarFlujo(e.juan, nuevo({ hito: "Aprobar estructura", archivos: ["e101", "modelo"] })),
    /«Obra \/ Diseño \/ Arquitectura \/ modelo.rvt» ya está en el flujo activo «Aprobar diseño arquitectónico Torre 1»/
  );
  const off = (await cambiarEstado(e.juan, { id: f.id, version: f.version, activo: false })).flujos[0];
  assert.equal(off.activo, false);
  const otro = await guardarFlujo(e.juan, nuevo({ hito: "Aprobar modelo definitivo", archivos: ["modelo"] }));
  assert.match(otro.mensaje!, /1 archivo que vuelve/, "the registered file moves to the new flow");
  await assert.rejects(() => cambiarEstado(e.juan, { id: f.id, version: off.version, activo: true }), /No se puede activar: «Obra \/ Diseño \/ Arquitectura \/ modelo.rvt» ya está en el flujo activo/);
  assert.deepEqual(
    (await historial(e.juan, f.id)).entradas.filter((x) => x.accion.startsWith("flujo-")).map((x) => x.accion),
    ["flujo-desactivado", "flujo-creado"]
  );
});

test("editar: cambiar el responsable alcanza a los archivos en trámite; quitar un archivo lo retira sin borrarlo y agregar uno lo registra", async () => {
  const e = escenario();
  const f = (await guardarFlujo(e.juan, nuevo())).flujos[0];
  const pasos = [
    { ...f.pasos[0], responsable: { tipo: "persona", id: "luz" } },
    { id: f.pasos[1].id, nombre: "Aprueba", responsable: RESP.aprueba },
  ];
  const r = await guardarFlujo(e.juan, edicion(f, { pasos, archivos: ["modelo", "e101"] }));
  assert.match(r.mensaje!, /1 archivo nuevo, 1 retirado/);
  const archivos = (await listarArchivos(e.juan)).archivos;
  assert.deepEqual(
    archivos.map((a) => [a.nombre, a.estado, a.responsables.join(", ")]),
    [
      ["modelo.rvt", "pendiente", "Luz Mora"],
      ["detalle.dwg", "retirado", ""],
      ["E-101.pdf", "pendiente", "Luz Mora"],
    ]
  );
  const h = await historial(e.juan, f.id);
  assert.equal(h.entradas.find((x) => x.accion === "flujo-modificado")!.detalle, "Responsable de «Revisa»: Luz Mora (antes Arquitectura (grupo)). Archivos agregados: E-101.pdf. Archivos quitados: detalle.dwg.");
  assert.match(h.entradas.find((x) => x.accion === "archivo-retirado")!.detalle, /^Se quitó del flujo «Aprobar diseño arquitectónico Torre 1»\. Queda como retirado; no se borra nada\.$/);
});

test("un cambio con una versión vieja se rechaza y no pisa lo que guardó otra persona", async () => {
  const e = escenario();
  const f = (await guardarFlujo(e.juan, nuevo())).flujos[0];
  const r = await guardarFlujo(e.juan, edicion(f, { hito: "Aprobar arquitectura Torre 1" }));
  assert.equal(r.flujos[0].version, 2);
  await assert.rejects(
    () => guardarFlujo(e.juan, edicion(f, { hito: "Otro nombre" })),
    (err: unknown) => err instanceof FlujoError && err.code === "version-conflict" && err.status === 409
  );
  assert.equal((await estado(e.juan)).flujos[0].hito, "Aprobar arquitectura Torre 1");
});

test("el equipo sale de Trimble sin las personas retiradas", async () => {
  const e = escenario();
  const t = await equipo(e.juan);
  assert.deepEqual(
    t.personas.map((p) => [p.nombre, p.admin]),
    [
      ["Ana Ruiz", true],
      ["Juan Pérez", false],
      ["Luz Mora", false],
      ["Pepe Gómez", false],
    ]
  );
  assert.deepEqual(t.grupos, [{ id: "g-arq", nombre: "Arquitectura" }]);
});

test("la revisión de permisos lee las carpetas donde están los archivos y avisa, sin cambiar nada", async () => {
  const e = escenario({
    permisos: {
      arq: { direct: { acl: { READ: ["tc-groups:g-arq"] }, inheritance: false }, inherited: {} },
      t1: { direct: { acl: {}, inheritance: true }, inherited: { READ: ["tc-groups:*"] } },
    },
  });
  const f = (await guardarFlujo(e.juan, nuevo())).flujos[0];
  const r = await permisosFlujo(e.juan, f.id);
  assert.deepEqual(
    r.avisos.map((a) => a.texto),
    ["En «Obra / Diseño / Arquitectura», Pepe Gómez («Aprueba») no aparece con acceso: no podrá abrir los archivos del flujo."]
  );
  assert.deepEqual(
    r.carpetas.map((c) => [c.ruta, c.lectura]),
    [
      ["Obra / Diseño / Arquitectura", ["Arquitectura (grupo)"]],
      ["Obra / Diseño / Arquitectura / Torre 1", ["Todos los miembros del proyecto"]],
    ]
  );
  await assert.rejects(() => permisosFlujo(e.pepe, f.id), /Solo quien creó este flujo/);
});

test("el flujo guarda su vencimiento y sus notas, y el cambio queda en el historial", async () => {
  const e = escenario();
  const f = (await guardarFlujo(e.juan, nuevo({ vence: "2026-11-25", notas: "Entrega del diseñador arquitectónico" }))).flujos[0];
  assert.equal(f.vence, "2026-11-25");
  assert.equal(f.notas, "Entrega del diseñador arquitectónico");
  assert.match((await historial(e.juan, f.id)).entradas.find((x) => x.accion === "flujo-creado")!.detalle, /Vence el 25-11-2026\./);
  const r = await guardarFlujo(e.juan, edicion(f, { vence: "", notas: "Entrega del diseñador arquitectónico" }));
  assert.equal(r.flujos[0].vence, null);
  assert.equal((await historial(e.juan, f.id)).entradas.find((x) => x.accion === "flujo-modificado")!.detalle, "Vencimiento: sin fecha (antes 25-11-2026).");
  await assert.rejects(() => guardarFlujo(e.juan, nuevo({ hito: "Otro", archivos: ["e101"], vence: "2026-13-01" })), /fecha de vencimiento no es válida/);
});

test("cualquier miembro comenta un flujo; los comentarios quedan con quién y cuándo, en orden", async () => {
  const e = escenario();
  const { comentarios, comentar } = await import("./service");
  const f = (await guardarFlujo(e.admin, nuevo())).flujos[0];
  await comentar(e.admin, { flujoId: f.id, texto: "  Recuerden subir los planos en PDF y DWG.  " });
  const r = await comentar(e.juan, { flujoId: f.id, texto: "Listo, subo hoy." });
  assert.deepEqual(
    r.comentarios.map((c) => [c.usuario, c.texto]),
    [
      ["Ana Ruiz", "Recuerden subir los planos en PDF y DWG."],
      ["Juan Pérez", "Listo, subo hoy."],
    ]
  );
  assert.equal((await comentarios(e.juan, f.id)).comentarios.length, 2);
  await assert.rejects(() => comentar(e.admin, { flujoId: f.id, texto: "   " }), /Escribe el comentario/);
  await assert.rejects(() => comentar(e.admin, { flujoId: f.id, texto: "x".repeat(2001) }), /hasta 2000/);
});
