import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { ARCHIVO_PRUEBA, CARPETA_PRUEBA, crearCarpeta, explicarEstado, iniciarSubida } from "./cde";
import { trimbleFalso } from "./pruebas/trimbleFalso";
import { memoriaLectura } from "./presupuestoLectura";
import { activar, Ctx, getAccesos, getAuditoria, guardarUsuario, pruebaCde } from "./service";
import { memoryStore } from "./store";
import type { Rol } from "./types";

describe("llamadas al CDE", () => {
  it("crea la carpeta con el id de versión del padre y, si lo rechaza, prueba con el id", async () => {
    const t = trimbleFalso();
    const hecha = await crearCarpeta(t.cliente, { id: "raiz", versionId: "raiz-v1", nombre: "", permiso: null }, "X");
    assert.deepEqual([hecha.con, !!hecha.carpeta], ["versionId", true]);
    const t2 = trimbleFalso({ soloId: true });
    const otra = await crearCarpeta(t2.cliente, { id: "raiz", versionId: "raiz-v1", nombre: "", permiso: null }, "X");
    assert.deepEqual([otra.con, !!otra.carpeta], ["id", true]);
  });

  it("la subida pide no duplicar y devuelve la URL firmada", async () => {
    const t = trimbleFalso();
    const s = await iniciarSubida(t.cliente, "raiz", "a.pdf", { soloNuevo: true });
    assert.equal(s.url, `https://s3.falso/put/${s.uploadId}`);
    assert.match(t.llamadas[0], /\/files\/fs\/upload\?parentId=raiz&parentType=FOLDER \[If-None-Match\]/);
  });

  it("explica las respuestas de Trimble en palabras", () => {
    assert.match(explicarEstado(403), /negó el permiso/);
    assert.match(explicarEstado(412), /ya existe/);
  });
});

describe("prueba de escritura en el CDE", () => {
  const ana: Caller = { id: "ana", name: "Ana Gómez", isAdmin: true };
  const jorge: Caller = { id: "jorge", name: "Jorge Ruiz", isAdmin: false };

  async function preparar(opciones = {}) {
    const store = memoryStore(() => "2026-10-16");
    const t = trimbleFalso(opciones);
    const ctx = (caller: Caller): Ctx => ({
      projectId: "obra1",
      caller,
      store,
      presupuesto: memoriaLectura(),
      hoy: "2026-10-16",
      deps: { contactos: async () => ({ users: [ana, jorge].map((p) => ({ id: p.id, name: p.name, email: "", pending: false })), groups: [] }), cde: async () => ({ cliente: t.cliente, rootId: "raiz" }), fetch: t.fetchFalso },
    });
    await activar(ctx(ana));
    const { roles } = await getAccesos(ctx(ana));
    await guardarUsuario(ctx(ana), { userId: "jorge", rolId: (roles.find((r) => r.clave === "director") as Rol).id, desde: "2026-10-16", hasta: null, activo: true, version: 0 });
    return { store, t, ctx };
  }

  it("crea la carpeta, sube el archivo, hace una versión nueva y rechaza el duplicado", async () => {
    const { t, ctx } = await preparar();
    const c = ctx(ana);
    const i = await pruebaCde(c, { paso: "inspeccionar" });
    assert.equal(i.datos.carpetaId, null);
    const carpeta = await pruebaCde(c, { paso: "crear-carpeta" });
    assert.equal(carpeta.ok, true);
    const carpetaId = carpeta.datos.carpetaId as string;
    assert.equal(t.carpetas.get(carpetaId)?.name, CARPETA_PRUEBA);
    // Again: it doesn't create another one.
    assert.equal((await pruebaCde(c, { paso: "crear-carpeta" })).datos.creada, false);

    // First upload: the browser would PUT the content; here the fake fetch does.
    const s1 = await pruebaCde(c, { paso: "iniciar-subida", carpetaId });
    assert.equal(s1.datos.nuevaVersion, false);
    await t.fetchFalso(s1.datos.url as string, { method: "PUT", body: s1.datos.contenido as string });
    const e1 = await pruebaCde(c, { paso: "estado-subida", uploadId: s1.datos.uploadId as string });
    assert.deepEqual([e1.ok, e1.datos.status, e1.datos.revision], [true, "DONE", 1]);

    // Second upload, done by the server: same name, new version.
    const s2 = await pruebaCde(c, { paso: "subir-desde-servidor", carpetaId });
    assert.equal(s2.datos.nuevaVersion, true);
    const e2 = await pruebaCde(c, { paso: "estado-subida", uploadId: s2.datos.uploadId as string });
    assert.equal(e2.datos.revision, 2);
    assert.equal([...t.archivos.values()].filter((a) => a.name === ARCHIVO_PRUEBA).length, 1);

    const d = await pruebaCde(c, { paso: "duplicado", carpetaId });
    assert.deepEqual([d.ok, d.datos.http], [true, 412]);
  });

  it("sin permiso en Trimble lo dice; sin Documentos: administrar no se deja hacer; todo queda en la auditoría", async () => {
    const { ctx, store } = await preparar({ sinPermiso: true });
    const r = await pruebaCde(ctx(ana), { paso: "crear-carpeta" });
    assert.equal(r.ok, false);
    assert.match(r.mensaje, /negó el permiso/);
    await assert.rejects(pruebaCde(ctx(jorge), { paso: "inspeccionar" }), (e: unknown) => e instanceof ServiceError && e.status === 403);
    const entradas = (await getAuditoria({ ...ctx(ana), store }, new URLSearchParams({ modulo: "documentos" }))).entradas;
    assert.deepEqual(entradas.map((e) => [e.accion, e.resultado]), [["cde.prueba", "denegado"], ["cde.prueba", "error"]]);
  });
});
