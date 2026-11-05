import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { FolderPermissions, ProjectUser } from "../trimbleApi";
import { FlujoError } from "./errores";
import { agregarAsignaciones, cambiarEstado, Ctx, equipo, estado, guardarFlujo, historial, permisosFlujo, quitarAsignacion, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import type { CarpetaFlujo } from "./types";

// Project "P": Obra > Diseño > {Arquitectura > Torre 1 > modelo.rvt, Estructura}, Obra > Aprobados, Obra > Otro proyecto? (no)
const CARPETAS: Record<string, CarpetaFlujo> = {
  dis: { id: "dis", ruta: "Obra / Diseño", ancestros: ["raiz"] },
  arq: { id: "arq", ruta: "Obra / Diseño / Arquitectura", ancestros: ["raiz", "dis"] },
  t1: { id: "t1", ruta: "Obra / Diseño / Arquitectura / Torre 1", ancestros: ["raiz", "dis", "arq"] },
  est: { id: "est", ruta: "Obra / Diseño / Estructura", ancestros: ["raiz", "dis"] },
  apr: { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] },
  apr2: { id: "apr2", ruta: "Obra / Aprobados 2", ancestros: ["raiz"] },
};
const ARCHIVOS: Record<string, CarpetaFlujo> = {
  modelo: { id: "modelo", ruta: "Obra / Diseño / Arquitectura / Torre 1 / modelo.rvt", ancestros: ["raiz", "dis", "arq", "t1"] },
  suelto: { id: "suelto", ruta: "Obra / Aprobados / plano.pdf", ancestros: ["raiz", "apr"] },
};
const persona = (id: string, firstName: string, lastName: string, extra: Partial<ProjectUser> = {}): ProjectUser => ({ id, firstName, lastName, email: `${id}@obra.co`, role: "USER", status: "ACTIVE", ...extra });
const PERSONAS = [persona("ana", "Ana", "Ruiz", { role: "ADMIN" }), persona("juan", "Juan", "Pérez"), persona("pepe", "Pepe", "Gómez"), persona("ido", "Ido", "Ya", { status: "REMOVED" })];

function escenario(o: { admin?: boolean; permisos?: Record<string, FolderPermissions> } = {}) {
  const store = memoryStore();
  const tc: TrimbleFlujo = {
    async carpeta(id) {
      const c = CARPETAS[id];
      if (!c) throw new FlujoError("No existe o no tienes acceso en Trimble Connect.", 404);
      return c;
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
    items: async () => [],
  };
  const caller = (admin: boolean): Caller => ({ id: admin ? "ana" : "juan", name: admin ? "Ana Ruiz" : "Juan Pérez", isAdmin: admin });
  const ctx: Ctx = { projectId: "P", caller: caller(o.admin ?? true), store, tc, ahora: () => new Date("2026-11-05T15:00:00Z") };
  const comoMiembro: Ctx = { ...ctx, caller: caller(false) };
  return { ctx, comoMiembro, store };
}

const nuevo = (extra: Record<string, unknown> = {}) => ({
  hito: "Aprobar diseño arquitectónico Torre 1",
  carpetas: ["arq"],
  destino: "apr",
  pasos: [{ nombre: "Revisa" }, { nombre: "Aprueba" }],
  ...extra,
});

test("el administrador crea un flujo con su hito; las rutas salen de Trimble y queda en el historial", async () => {
  const { ctx } = escenario();
  const r = await guardarFlujo(ctx, nuevo({ hito: "  Aprobar  diseño arquitectónico Torre 1 " }));
  assert.equal(r.esAdmin, true);
  const f = r.flujos[0];
  assert.equal(f.hito, "Aprobar diseño arquitectónico Torre 1");
  assert.deepEqual(f.pasos, [
    { id: "p1", nombre: "Revisa" },
    { id: "p2", nombre: "Aprueba" },
  ]);
  assert.deepEqual(f.carpetas, [CARPETAS.arq]);
  assert.deepEqual(f.destino, CARPETAS.apr);
  assert.equal(f.version, 1);
  const h = await historial(ctx, f.id);
  assert.equal(h.entradas[0].accion, "flujo-creado");
  assert.equal(
    h.entradas[0].detalle,
    "«Aprobar diseño arquitectónico Torre 1»: Realiza → Revisa → Aprueba. Revisión: Obra / Diseño / Arquitectura. Destino: Obra / Aprobados."
  );
  assert.equal(h.entradas[0].usuario, "Ana Ruiz");
});

test("quien no es administrador ve los flujos pero no los cambia", async () => {
  const { ctx, comoMiembro } = escenario();
  await guardarFlujo(ctx, nuevo());
  const r = await estado(comoMiembro);
  assert.equal(r.esAdmin, false);
  assert.equal(r.flujos.length, 1);
  await assert.rejects(() => guardarFlujo(comoMiembro, nuevo({ hito: "Otro" })), /Solo los administradores/);
});

test("el hito no se repite, aunque cambien tildes o mayúsculas", async () => {
  const { ctx } = escenario();
  await guardarFlujo(ctx, nuevo());
  await assert.rejects(() => guardarFlujo(ctx, nuevo({ hito: "APROBAR diseno arquitectonico torre 1", carpetas: ["est"], destino: "apr2" })), /Ya hay un flujo con ese título o hito/);
});

test("una carpeta no puede estar en dos flujos activos, y el destino no puede quedar dentro de una carpeta de revisión", async () => {
  const { ctx } = escenario();
  await guardarFlujo(ctx, nuevo());
  await assert.rejects(() => guardarFlujo(ctx, nuevo({ hito: "Aprobar estructura", carpetas: ["arq", "est"], destino: "apr2" })), /ya es carpeta de revisión del flujo «Aprobar diseño arquitectónico Torre 1»/);
  await assert.rejects(() => guardarFlujo(ctx, nuevo({ hito: "Aprobar estructura", carpetas: ["dis"], destino: "t1" })), /La carpeta destino «Obra \/ Diseño \/ Arquitectura \/ Torre 1» de este flujo está dentro de «Obra \/ Diseño»/);
  // A nested folder in another flow is allowed: the closest one wins.
  const r = await guardarFlujo(ctx, nuevo({ hito: "Aprobar Torre 1 en detalle", carpetas: ["t1"], destino: "apr2" }));
  assert.equal(r.flujos.length, 2);
});

test("un cambio con una versión vieja se rechaza y no pisa lo que guardó otra persona", async () => {
  const { ctx } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  const r = await guardarFlujo(ctx, { ...nuevo({ hito: "Aprobar arquitectura Torre 1" }), id: f.id, version: 1, pasos: f.pasos });
  assert.equal(r.flujos[0].version, 2);
  await assert.rejects(
    () => guardarFlujo(ctx, { ...nuevo({ hito: "Otro nombre" }), id: f.id, version: 1, pasos: f.pasos }),
    (e: unknown) => e instanceof FlujoError && e.code === "version-conflict" && e.status === 409
  );
  assert.equal((await estado(ctx)).flujos[0].hito, "Aprobar arquitectura Torre 1");
});

test("se asigna quién hace qué en carpetas o archivos del flujo, con nombres de Trimble y sin repetir", async () => {
  const { ctx } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  const r = await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }, { tipo: "archivo", id: "modelo" }], quien: { tipo: "persona", id: "juan" }, papel: "p1" });
  assert.equal(r.mensaje, "Juan Pérez queda con «Revisa» en 2 carpetas o archivos.");
  const a = r.flujos[0].asignaciones;
  assert.deepEqual(
    a.map((x) => [x.objetivoTipo, x.objetivoRuta, x.quienNombre, x.papel]),
    [
      ["carpeta", "Obra / Diseño / Arquitectura", "Juan Pérez", "p1"],
      ["archivo", "Obra / Diseño / Arquitectura / Torre 1 / modelo.rvt", "Juan Pérez", "p1"],
    ]
  );
  const otra = await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }, { tipo: "carpeta", id: "t1" }], quien: { tipo: "persona", id: "juan" }, papel: "p1" });
  assert.equal(otra.mensaje, "Juan Pérez queda con «Revisa» en 1 carpeta o archivo (1 ya lo tenía).");
  const grupo = await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "grupo", id: "g-arq" }, papel: "realiza" });
  assert.equal(grupo.mensaje, "Arquitectura (grupo) queda con «Realiza» en 1 carpeta o archivo.");
  const h = await historial(ctx, f.id);
  assert.equal(h.entradas[0].detalle, "Arquitectura (grupo): Realiza en Obra / Diseño / Arquitectura.");
});

test("no se asigna fuera de las carpetas del flujo, a quien no está en Trimble ni a un paso que no existe", async () => {
  const { ctx } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  const base = { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "juan" }, papel: "p1" };
  await assert.rejects(() => agregarAsignaciones(ctx, { ...base, objetivos: [{ tipo: "archivo", id: "suelto" }] }), /«Obra \/ Aprobados \/ plano.pdf» no está dentro de las carpetas de revisión/);
  await assert.rejects(() => agregarAsignaciones(ctx, { ...base, quien: { tipo: "persona", id: "ido" } }), /no está en el equipo del proyecto/);
  await assert.rejects(() => agregarAsignaciones(ctx, { ...base, quien: { tipo: "grupo", id: "g-x" } }), /Ese grupo no existe/);
  await assert.rejects(() => agregarAsignaciones(ctx, { ...base, papel: "p9" }), /Ese paso ya no existe/);
});

test("quitar un paso con asignaciones pide confirmación y luego las desactiva sin borrarlas", async () => {
  const { ctx, store } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "juan" }, papel: "p1" });
  await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "pepe" }, papel: "p2" });
  const cambio = { ...nuevo(), id: f.id, version: f.version, pasos: [{ id: "p2", nombre: "Aprueba" }] };
  await assert.rejects(
    () => guardarFlujo(ctx, cambio),
    (e: unknown) => e instanceof FlujoError && e.code === "confirmar-asignaciones" && /queda sin uso 1 asignación: Juan Pérez \(Revisa en Obra \/ Diseño \/ Arquitectura\)/.test(e.message)
  );
  assert.equal((await estado(ctx)).flujos[0].pasos.length, 2, "nothing saved without confirmation");
  const r = await guardarFlujo(ctx, { ...cambio, confirmar: true });
  assert.deepEqual(
    r.flujos[0].asignaciones.map((a) => a.quienId),
    ["pepe"]
  );
  assert.equal((await store.asignaciones("P")).length, 2, "the removed one is kept, inactive");
  assert.match((await historial(ctx, f.id)).entradas[0].detalle, /Pasos: Realiza → Aprueba \(antes Realiza → Revisa → Aprueba\)\. Asignaciones desactivadas: 1\./);
});

test("un flujo se desactiva sin borrarse y solo se reactiva si nadie tomó sus carpetas", async () => {
  const { ctx } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  const off = (await cambiarEstado(ctx, { id: f.id, version: f.version, activo: false })).flujos[0];
  assert.equal(off.activo, false);
  // Its folder is free now for another flow.
  await guardarFlujo(ctx, nuevo({ hito: "Aprobar arquitectura nueva", destino: "apr2" }));
  await assert.rejects(() => cambiarEstado(ctx, { id: f.id, version: off.version, activo: true }), /No se puede activar: «Obra \/ Diseño \/ Arquitectura» ya es carpeta de revisión/);
  const h = await historial(ctx, f.id);
  assert.deepEqual(
    h.entradas.map((e) => e.accion),
    ["flujo-desactivado", "flujo-creado"]
  );
});

test("quitar una asignación la deja inactiva y lo anota", async () => {
  const { ctx, store } = escenario();
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  const r = await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "juan" }, papel: "consulta" });
  const sin = await quitarAsignacion(ctx, { id: r.flujos[0].asignaciones[0].id });
  assert.equal(sin.flujos[0].asignaciones.length, 0);
  assert.equal((await store.asignaciones("P"))[0].activa, false);
  assert.equal((await historial(ctx, f.id)).entradas[0].detalle, "Juan Pérez: ya no tiene «Consulta» en Obra / Diseño / Arquitectura.");
});

test("el equipo sale de Trimble sin las personas retiradas", async () => {
  const { ctx } = escenario();
  const e = await equipo(ctx);
  assert.deepEqual(
    e.personas.map((p) => [p.nombre, p.admin]),
    [
      ["Ana Ruiz", true],
      ["Juan Pérez", false],
      ["Pepe Gómez", false],
    ]
  );
  assert.deepEqual(e.grupos, [{ id: "g-arq", nombre: "Arquitectura" }]);
});

test("la revisión de permisos lee Trimble y avisa, sin cambiar nada", async () => {
  const { ctx } = escenario({
    permisos: {
      apr: { direct: { acl: { FULL_ACCESS: ["tc-groups:g-arq"] }, inheritance: false }, inherited: { FULL_ACCESS: ["tc-groups:*"] } },
      arq: { direct: { acl: {}, inheritance: true }, inherited: { READ: ["tc-groups:*"] } },
    },
  });
  const f = (await guardarFlujo(ctx, nuevo())).flujos[0];
  await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "pepe" }, papel: "p2" });
  await agregarAsignaciones(ctx, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: "arq" }], quien: { tipo: "persona", id: "juan" }, papel: "realiza" });
  const r = await permisosFlujo(ctx, f.id);
  assert.deepEqual(
    r.avisos.map((a) => a.texto),
    [
      "En la carpeta destino también tiene acceso completo Arquitectura (grupo): puede subir archivos sin pasar por el flujo.",
      "Pepe Gómez aprueba («Aprueba») pero no aparece con acceso completo a la carpeta destino: la copia con su usuario fallaría y la tendría que hacer un administrador.",
      "En «Obra / Diseño / Arquitectura», Juan Pérez realiza pero solo tiene lectura: no podrá subir archivos.",
    ]
  );
  assert.deepEqual(r.carpetas[0].completo, ["Arquitectura (grupo)"]);
});
