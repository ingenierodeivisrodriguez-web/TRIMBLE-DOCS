// Test helper: a fake Trimble Connect for the CDE tests (not used by the app).
import type { ClienteTrimble, Respuesta } from "../cde";

/**
 * A Trimble Connect that behaves as its API documents: folders need the
 * parent's version id, uploads give a signed URL, the content arrives with a
 * PUT, the same name makes a new version and "If-None-Match: *" refuses it.
 */
export function trimbleFalso(opciones: { soloId?: boolean; sinPermiso?: boolean } = {}) {
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
        if (!s.recibido) return responder(200, { status: "UPLOADABLE", contents: [{ url: `https://s3.falso/put/${url.searchParams.get("uploadId")}` }] });
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
      if (metodo === "GET" && partes[0] === "files" && partes[1] === "fs" && partes[3] === "downloadurl") {
        return [...archivos.values()].some((a) => a.id === partes[2]) ? responder(200, { url: `https://descarga.falsa/${partes[2]}` }) : responder(404);
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
  /** Makes an open upload expire (as Trimble does after 90 minutes without content). */
  const vencer = (uploadId: string) => subidas.delete(uploadId);
  return { cliente, fetchFalso, llamadas, carpetas, archivos, subidas, vencer };
}
