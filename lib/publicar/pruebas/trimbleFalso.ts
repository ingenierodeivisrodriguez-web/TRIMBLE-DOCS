// Test helper: a fake Trimble Connect with several projects (not used by the app).
import { createHash } from "node:crypto";
import type { ClienteTrimble, Respuesta } from "../../compras/cde";

interface Version {
  versionId: string;
  revision: number;
  contenido: Uint8Array;
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

const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");

/**
 * Projects with folders and files with versions, behaving as the Core API
 * documents: folders need the parent's version id; uploads give a signed URL
 * the content goes to with a PUT; the same name makes a new version;
 * "If-None-Match: *" refuses an existing name and "If-Match" a version that
 * isn't the latest; download links give the content with its length.
 * `rechazarFlujo`: a streamed PUT fails (to test the in-memory copy).
 */
export function nubeFalsa(opciones: { rechazarFlujo?: boolean } = {}) {
  const carpetas = new Map<string, Carpeta>();
  const archivos = new Map<string, Archivo>();
  const subidas = new Map<string, { carpeta: string; name: string; contenido: Uint8Array | null; hecho: boolean }>();
  const llamadas: string[] = [];
  let n = 0;
  const responder = (estado: number, cuerpo: unknown = {}): Respuesta => ({ estado, cuerpo });
  const ultima = (a: Archivo) => a.versiones[a.versiones.length - 1];
  const detalle = (a: Archivo, v = ultima(a)) => ({ id: a.id, name: a.name, parentId: a.parent, versionId: v.versionId, revision: v.revision, size: v.contenido.byteLength, md5: md5(v.contenido) });

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
          const a = tipo === "FILE" ? [...archivos.values()].find((x) => x.parent === partes[1] && x.name === nombre) : undefined;
          if (c) return responder(200, { id: c.id, versionId: c.versionId });
          if (a) return responder(200, { id: a.id, versionId: ultima(a).versionId });
          return responder(404);
        }
        if (metodo === "POST" && ruta === "/folders") {
          const { name, parentId } = o.cuerpo as { name: string; parentId: string };
          const padre = [...carpetas.values()].find((x) => x.versionId === parentId);
          if (!padre) return responder(400, { message: "parent not found" });
          if (padre.permiso === "READ") return responder(403);
          const id = `carpeta${++n}`;
          carpetas.set(id, { id, versionId: `${id}-v1`, name, parent: padre.id, permiso: "FULL_ACCESS" });
          return responder(201, { id, versionId: `${id}-v1`, name, permission: "FULL_ACCESS" });
        }
        if (metodo === "POST" && url.pathname === "/files/fs/upload") {
          const carpeta = url.searchParams.get("parentId")!;
          if (carpetas.get(carpeta)?.permiso === "READ") return responder(403);
          const { name } = o.cuerpo as { name: string };
          const existente = [...archivos.values()].find((x) => x.parent === carpeta && x.name === name);
          if (existente && o.encabezados?.["If-None-Match"] === "*") return responder(412, { message: "exists" });
          const siVersion = o.encabezados?.["If-Match"];
          if (siVersion && (!existente || ultima(existente).versionId !== siVersion)) return responder(412, { message: "not the latest version" });
          const uploadId = `subida${++n}`;
          subidas.set(uploadId, { carpeta, name, contenido: null, hecho: false });
          return responder(202, { uploadId, status: "UPLOADABLE", contents: [{ url: `https://s3.falso/subir/${uploadId}` }] });
        }
        if (metodo === "GET" && url.pathname === "/files/fs/upload") {
          const uploadId = url.searchParams.get("uploadId")!;
          const s = subidas.get(uploadId);
          if (!s) return responder(404);
          if (!s.contenido) return responder(200, { status: "UPLOADABLE", contents: [{ url: `https://s3.falso/subir/${uploadId}` }] });
          let a = [...archivos.values()].find((x) => x.parent === s.carpeta && x.name === s.name);
          if (!s.hecho) {
            if (!a) {
              a = { id: `archivo${++n}`, name: s.name, parent: s.carpeta, versiones: [] };
              archivos.set(a.id, a);
            }
            const revision = a.versiones.length + 1;
            a.versiones.push({ versionId: `${a.id}-v${revision}`, revision, contenido: s.contenido });
            s.hecho = true;
          }
          const v = ultima(a!);
          return responder(200, { status: "DONE", fileId: a!.id, versionId: v.versionId, revision: v.revision });
        }
        if (metodo === "GET" && partes[0] === "files" && partes[1] === "fs" && partes[3] === "downloadurl") {
          const a = archivos.get(partes[2]);
          return a ? responder(200, { url: `https://s3.falso/bajar/${a.id}/${ultima(a).versionId}` }) : responder(404);
        }
        if (metodo === "GET" && partes[0] === "files" && partes.length === 2) {
          const a = archivos.get(partes[1]);
          return a ? responder(200, detalle(a)) : responder(404);
        }
        if (metodo === "GET" && partes[0] === "files" && partes[2] === "versions") {
          const a = archivos.get(partes[1]);
          return a ? responder(206, [...a.versiones].reverse().map((v) => detalle(a, v))) : responder(404);
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
    if (url.startsWith("https://s3.falso/bajar/")) {
      const a = archivos.get(partes[4]);
      const v = a?.versiones.find((x) => x.versionId === partes[5]);
      if (!v) return new Response(null, { status: 403 });
      return new Response(v.contenido.slice(), { status: 200, headers: { "content-length": String(v.contenido.byteLength) } });
    }
    if (url.startsWith("https://s3.falso/subir/") && init?.method === "PUT") {
      if (opciones.rechazarFlujo && init.body instanceof ReadableStream) throw new TypeError("fetch failed");
      const s = subidas.get(partes[4]);
      if (!s) return new Response(null, { status: 403 });
      s.contenido = new Uint8Array(await new Response(init.body).arrayBuffer());
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  /** Puts a file in a folder (as if a person had uploaded it). */
  function sembrarArchivo(carpeta: string, name: string, contenido: string): string {
    const id = `archivo${++n}`;
    archivos.set(id, { id, name, parent: carpeta, versiones: [{ versionId: `${id}-v1`, revision: 1, contenido: new TextEncoder().encode(contenido) }] });
    return id;
  }

  function sembrarCarpeta(padre: string, name: string, permiso: Carpeta["permiso"] = "FULL_ACCESS"): string {
    const id = `carpeta${++n}`;
    carpetas.set(id, { id, versionId: `${id}-v1`, name, parent: padre, permiso });
    return id;
  }

  return { proyecto, fetchFalso, llamadas, carpetas, archivos, sembrarArchivo, sembrarCarpeta };
}
