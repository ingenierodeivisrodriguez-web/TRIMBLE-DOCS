// Test helper: a fake Trimble Connect with several projects (not used by the app).
import { createHash } from "node:crypto";
import type { ClienteTrimble, Respuesta } from "../../compras/cde";

interface Version {
  versionId: string;
  revision: number;
  contenido: Uint8Array;
  /** The converted model of this version (TRB), once there is one. */
  modelo: Uint8Array | null;
}

interface Archivo {
  id: string;
  name: string;
  parent: string;
  versiones: Version[];
}

interface Carpeta {
  id: string;
  versionId: string;
  name: string;
  parent: string | null;
  permiso: "READ" | "FULL_ACCESS";
}

interface SubidaFalsa {
  carpeta: string;
  name: string;
  conModelo: boolean;
  contenido: Uint8Array | null;
  modelo: Uint8Array | null;
  hecho: boolean;
}

const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const texto = (s: string) => new TextEncoder().encode(s);

/**
 * Projects with folders and files with versions, behaving as the Core API
 * documents: folders need the parent's version id; uploads give a signed URL
 * per content (the file, and its TRB model when asked) that takes a PUT; the
 * same name makes a new version; "If-None-Match: *" refuses an existing name
 * and "If-Match" a version that isn't the latest; download links give the
 * content with its length; POST /files copies a version (with its model).
 * Options: `rechazarFlujo` (a streamed PUT fails), `sinCopiaTrimble`
 * (POST /files refused, as between projects it may be), `rechazarModelo`
 * (an upload carrying a TRB is refused).
 */
export function nubeFalsa(opciones: { rechazarFlujo?: boolean; sinCopiaTrimble?: boolean; rechazarModelo?: boolean } = {}) {
  const carpetas = new Map<string, Carpeta>();
  const archivos = new Map<string, Archivo>();
  const subidas = new Map<string, SubidaFalsa>();
  const llamadas: string[] = [];
  let n = 0;
  const responder = (estado: number, cuerpo: unknown = {}): Respuesta => ({ estado, cuerpo });
  const ultima = (a: Archivo) => a.versiones[a.versiones.length - 1];
  const detalle = (a: Archivo, v = ultima(a)) => ({
    id: a.id,
    name: a.name,
    parentId: a.parent,
    versionId: v.versionId,
    revision: v.revision,
    size: v.contenido.byteLength,
    md5: md5(v.contenido),
    modifiedBy: { firstName: "Ana", lastName: "Ruiz" },
    modifiedOn: "2026-10-27T15:20:00.000Z",
  });
  const enCarpeta = (carpeta: string, name: string) => [...archivos.values()].find((x) => x.parent === carpeta && x.name === name);

  /** Adds a version to the file of that name in the folder (or creates the file). */
  function guardar(carpeta: string, name: string, contenido: Uint8Array, modelo: Uint8Array | null): Archivo {
    let a = enCarpeta(carpeta, name);
    if (!a) {
      a = { id: `archivo${++n}`, name, parent: carpeta, versiones: [] };
      archivos.set(a.id, a);
    }
    const revision = a.versiones.length + 1;
    a.versiones.push({ versionId: `${a.id}-v${revision}`, revision, contenido, modelo });
    return a;
  }

  function proyecto(projectId: string) {
    const raiz: Carpeta = { id: `${projectId}-raiz`, versionId: `${projectId}-raiz-v1`, name: projectId, parent: null, permiso: "FULL_ACCESS" };
    carpetas.set(raiz.id, raiz);
    const cliente: ClienteTrimble = {
      async pedir(metodo, ruta, o = {}) {
        llamadas.push(`${projectId} ${metodo} ${ruta}${o.encabezados?.["If-None-Match"] ? " [If-None-Match]" : ""}${o.encabezados?.["If-Match"] ? ` [If-Match ${o.encabezados["If-Match"]}]` : ""}`);
        const url = new URL(`https://tc${ruta}`);
        const partes = url.pathname.split("/").filter(Boolean);
        if (metodo === "GET" && partes[0] === "folders" && partes.length === 2) {
          const c = carpetas.get(partes[1]);
          return c ? responder(200, { id: c.id, versionId: c.versionId, name: c.name, permission: c.permiso }) : responder(404);
        }
        if (metodo === "GET" && partes[0] === "folders" && partes[2] === "item") {
          const nombre = url.searchParams.get("name");
          const tipo = url.searchParams.get("type");
          const c = tipo === "FOLDER" ? [...carpetas.values()].find((x) => x.parent === partes[1] && x.name === nombre) : undefined;
          const a = tipo === "FILE" ? enCarpeta(partes[1], nombre ?? "") : undefined;
          if (c) return responder(200, { id: c.id, versionId: c.versionId });
          if (a) return responder(200, { id: a.id, versionId: ultima(a).versionId });
          return responder(404);
        }
        if (metodo === "POST" && ruta === "/files") {
          if (opciones.sinCopiaTrimble) return responder(400, { message: "copy between projects not supported" });
          const { parentId, fromFileVersionId, mergeExisting } = o.cuerpo as { parentId: string; fromFileVersionId: string; mergeExisting: boolean };
          if (carpetas.get(parentId)?.permiso === "READ") return responder(403);
          const origen = [...archivos.values()].find((x) => x.versiones.some((v) => v.versionId === fromFileVersionId));
          const v = origen?.versiones.find((x) => x.versionId === fromFileVersionId);
          if (!origen || !v) return responder(404);
          if (enCarpeta(parentId, origen.name) && !mergeExisting) return responder(409, { message: "exists" });
          return responder(201, detalle(guardar(parentId, origen.name, v.contenido, v.modelo)));
        }
        if (metodo === "POST" && url.pathname === "/files/fs/upload") {
          const carpeta = url.searchParams.get("parentId")!;
          if (carpetas.get(carpeta)?.permiso === "READ") return responder(403);
          const { name, contents } = o.cuerpo as { name: string; contents?: { format?: string }[] };
          const conModelo = !!contents?.some((x) => x.format === "TRB");
          if (conModelo && opciones.rechazarModelo) return responder(400, { message: "TRB not supported for this file" });
          const existente = enCarpeta(carpeta, name);
          if (existente && o.encabezados?.["If-None-Match"] === "*") return responder(412, { message: "exists" });
          const siVersion = o.encabezados?.["If-Match"];
          if (siVersion && (!existente || ultima(existente).versionId !== siVersion)) return responder(412, { message: "not the latest version" });
          const uploadId = `subida${++n}`;
          subidas.set(uploadId, { carpeta, name, conModelo, contenido: null, modelo: null, hecho: false });
          const contenidos = [{ url: `https://s3.falso/subir/${uploadId}` }, ...(conModelo ? [{ format: "TRB", url: `https://s3.falso/subir/${uploadId}/trb` }] : [])];
          return responder(202, { uploadId, status: "UPLOADABLE", contents: contenidos });
        }
        if (metodo === "GET" && url.pathname === "/files/fs/upload") {
          const uploadId = url.searchParams.get("uploadId")!;
          const s = subidas.get(uploadId);
          if (!s) return responder(404);
          if (!s.contenido || (s.conModelo && !s.modelo)) return responder(200, { status: "UPLOADABLE" });
          if (!s.hecho) {
            guardar(s.carpeta, s.name, s.contenido, s.modelo);
            s.hecho = true;
          }
          const a = enCarpeta(s.carpeta, s.name)!;
          const v = ultima(a);
          return responder(200, { status: "DONE", fileId: a.id, versionId: v.versionId, revision: v.revision });
        }
        if (metodo === "GET" && partes[0] === "files" && partes[1] === "fs" && partes[3] === "downloadurl") {
          const a = archivos.get(partes[2]);
          if (!a) return responder(404);
          if (url.searchParams.get("format") === "TRB") return ultima(a).modelo ? responder(200, { url: `https://s3.falso/modelo/${a.id}` }) : responder(404, { message: "no TRB" });
          return responder(200, { url: `https://s3.falso/bajar/${a.id}/${ultima(a).versionId}` });
        }
        if (metodo === "GET" && partes[0] === "files" && partes.length === 2) {
          const a = archivos.get(partes[1]);
          return a ? responder(200, detalle(a)) : responder(404);
        }
        if (metodo === "GET" && partes[0] === "files" && partes[2] === "status") {
          const a = archivos.get(partes[1]);
          return a ? responder(200, { status: ultima(a).modelo ? "PROCESSED" : "PROCESSING" }) : responder(404);
        }
        return responder(404);
      },
    };
    return { cliente, servidor: `https://${projectId}.falso/tc/api/2.0`, raiz: raiz.id };
  }

  const fetchFalso = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    llamadas.push(`${init?.method ?? "GET"} ${url}`);
    const partes = url.split("/");
    const servir = (b: Uint8Array) => new Response(b.slice(), { status: 200, headers: { "content-length": String(b.byteLength) } });
    if (url.startsWith("https://s3.falso/bajar/")) {
      const v = archivos.get(partes[4])?.versiones.find((x) => x.versionId === partes[5]);
      return v ? servir(v.contenido) : new Response(null, { status: 403 });
    }
    if (url.startsWith("https://s3.falso/modelo/")) {
      const a = archivos.get(partes[4]);
      const m = a ? ultima(a).modelo : null;
      return m ? servir(m) : new Response(null, { status: 403 });
    }
    if (url.startsWith("https://s3.falso/subir/") && init?.method === "PUT") {
      if (opciones.rechazarFlujo && init.body instanceof ReadableStream) throw new TypeError("fetch failed");
      const s = subidas.get(partes[4]);
      if (!s) return new Response(null, { status: 403 });
      const datos = new Uint8Array(await new Response(init.body).arrayBuffer());
      if (partes[5] === "trb") s.modelo = datos;
      else s.contenido = datos;
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  /** Puts a file in a folder (as if a person had uploaded it), with its converted model if given. */
  function sembrarArchivo(carpeta: string, name: string, contenido: string, modelo?: string): string {
    return guardar(carpeta, name, texto(contenido), modelo === undefined ? null : texto(modelo)).id;
  }

  function sembrarCarpeta(padre: string, name: string, permiso: Carpeta["permiso"] = "FULL_ACCESS"): string {
    const id = `carpeta${++n}`;
    carpetas.set(id, { id, versionId: `${id}-v1`, name, parent: padre, permiso });
    return id;
  }

  return { proyecto, fetchFalso, llamadas, carpetas, archivos, sembrarArchivo, sembrarCarpeta };
}
