import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { ARCHIVO_PRUEBA, CARPETA_PRUEBA, ClienteTrimble, crearCarpeta, explicarEstado, iniciarSubida, Respuesta } from "./cde";
import { memoriaLectura } from "./presupuestoLectura";
import { activar, Ctx, getAccesos, getAuditoria, guardarUsuario, pruebaCde } from "./service";
import { memoryStore } from "./store";
import type { Rol } from "./types";

/**
 * A Trimble Connect that behaves as its API documents: folders need the
 * parent's version id, uploads give a signed URL, the content arrives with a
 * PUT, the same name makes a new version and "If-None-Match: *" refuses it.
 */
function trimbleFalso(opciones: { soloId?: boolean; sinPermiso?: boolean } = {}) {
  const carpetas = new Map<string, { id: string; versionId: string; name: string; parent: string | null }>([["raiz", { id: "raiz", versionId: "raiz-v1", name: "Proyecto", parent: null }]]);
  const archivos = new Map<string, { id: string; name: string; parent: string; revision: number }>();
  const subidas = new Map<string, { carpeta: string; name: string; recibido: boolean; hecho: boolean }>();
  const llamadas: string[] = [];
  let n = 0;
  const responder = (estado: number, cuerpo: unknown = {}): Respuesta => ({ estado, cuerpo });
  const cliente: ClienteTrimble = {
    async pedir(metodo, ruta, o = {}) {
      llamadas.push(`${metodo} ${ruta}${o.encabezados?.["If-None-Match"] ? " [If-None-Match]" : ""}${o.encabezados?.["If-Match"] ? " [If-Match]" : ""}`);
      const url = new URL(`https://tc${ruta}`);
      const partes = url.pathname.split("/").filter(Boolean);
      if (metodo === "GET" && partes[0] === "folders" && partes.length === 2) {
        const c = carpetas.get(partes[1]);
        return c ? responder(200, { ...c, permission: "FULL_ACCESS" }) : responder(404);
      }
      if (metodo === "GET" && partes[0] === "folders" && partes[2] === "item") {
        const nombre = url.searchParams.get("name");
        const tipo = url.searchParams.get("type");
        const c = tipo === "FOLDER" ? [...carpetas.values()].find((x) => x.parent === partes[1] && x.name === nombre) : undefined;
        const a = tipo === "FILE" ? [...archivos.values()].find((x) => x.parent === partes[1] && x.name === nombre) : undefined;
        if (c) return responder(200, { id: c.id, versionId: c.versionId });
        if (a) return responder(200, { id: a.id, versionId: `${a.id}-v${a.revision}` });
        return responder(404);
      }
      if (metodo === "POST" && ruta === "/folders") {
        if (opciones.sinPermiso) return responder(403);
        const { name, parentId } = o.cuerpo as { name: string; parentId: string };
        const padre = [...carpetas.values()].find((x) => (opciones.soloId ? x.id : x.versionId) === parentId);
        if (!padre) return responder(400, { message: "parent not found" });
        const id = `carpeta${++n}`;
        carpetas.set(id, { id, versionId: `${id}-v1`, name, parent: padre.id });
        return responder(201, { id, versionId: `${id}-v1`, name, permission: "FULL_ACCESS" });
      }
      if (metodo === "POST" && url.pathname === "/files/fs/upload") {
        const carpeta = url.searchParams.get("parentId")!;
        const { name } = o.cuerpo as { name: string };
        const existente = [...archivos.values()].find((x) => x.parent === carpeta && x.name === name);
        if (existente && o.encabezados?.["If-None-Match"] === "*") return responder(412, { message: "exists" });
        const uploadId = `subida${++n}`;
        subidas.set(uploadId, { carpeta, name, recibido: false, hecho: false });
        return responder(202, { uploadId, status: "UPLOADABLE", ...(existente ? { fileId: existente.id } : {}), contents: [{ url: `https://s3.falso/put/${uploadId}` }] });
      }
      if (metodo === "GET" && url.pathname === "/files/fs/upload") {
        const s = subidas.get(url.searchParams.get("uploadId")!);
        if (!s) return responder(404);
        if (!s.recibido) return responder(200, { status: "UPLOADABLE" });
        let a = [...archivos.values()].find((x) => x.parent === s.carpeta && x.name === s.name);
        if (!s.hecho) {
          if (a) a.revision += 1;
          else {
            a = { id: `archivo${++n}`, name: s.name, parent: s.carpeta, revision: 1 };
            archivos.set(a.id, a);
          }
          s.hecho = true;
        }
        return responder(200, { status: "DONE", fileId: a!.id, versionId: `${a!.id}-v${a!.revision}`, revision: a!.revision });
      }
      return responder(404);
    },
  };
  const fetchFalso = (async (u: string, init?: RequestInit) => {
    llamadas.push(`${init?.method} ${u}`);
    const s = subidas.get(String(u).split("/").pop()!);
    if (s && init?.method === "PUT") s.recibido = true;
    return new Response(null, { status: s ? 200 : 403 });
  }) as typeof fetch;
  return { cliente, fetchFalso, llamadas, carpetas, archivos };
}

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
