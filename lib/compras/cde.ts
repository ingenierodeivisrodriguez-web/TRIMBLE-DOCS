/**
 * Writing to the project's CDE (Trimble Connect folders) with the user's own
 * token, through the Core API 2.0 of the project's region:
 *   POST /folders                         create a folder ({ name, parentId })
 *   GET  /folders/{id}/item?name=&type=   find an item by name
 *   POST /files/fs/upload?parentId=&parentType=FOLDER  start an upload ({ name });
 *        the content goes with a PUT to the signed URL it returns (no token);
 *        the same name in the same folder makes a new version, and
 *        "If-None-Match: *" makes it fail instead.
 *   GET  /files/fs/upload?uploadId=       how the upload went (DONE: fileId, versionId, revision)
 * This module only builds the calls and reads their answers; it never deletes.
 */

export const CARPETA_PRUEBA = "Compras - prueba de conexión (se puede borrar)";
export const ARCHIVO_PRUEBA = "prueba-compras.txt";

export interface Respuesta {
  estado: number;
  cuerpo: unknown;
}

export interface ClienteTrimble {
  pedir(metodo: "GET" | "POST", ruta: string, opciones?: { cuerpo?: unknown; encabezados?: Record<string, string> }): Promise<Respuesta>;
}

type Fetch = typeof fetch;

/** The Core API of the project's region with the user's token; answers never throw (the status says what happened). */
export function clienteTrimble(baseUrl: string, token: string, fetchFn: Fetch = fetch): ClienteTrimble {
  return {
    async pedir(metodo, ruta, opciones = {}) {
      const res = await fetchFn(`${baseUrl}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(opciones.cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...opciones.encabezados },
        body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      const texto = await res.text().catch(() => "");
      let cuerpo: unknown = texto;
      try {
        cuerpo = texto ? JSON.parse(texto) : null;
      } catch {
        // not JSON
      }
      return { estado: res.status, cuerpo };
    },
  };
}

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;
const campo = (r: Respuesta, k: string): string | null => {
  const v = (r.cuerpo as Record<string, unknown> | null)?.[k];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
};

/** What an HTTP status means for the person doing the test. */
export function explicarEstado(estado: number): string {
  if (estado === 401) return "Trimble no aceptó la sesión (token vencido o sin ese alcance).";
  if (estado === 403) return "Trimble negó el permiso: tu usuario no puede escribir ahí.";
  if (estado === 404) return "No existe (o no lo puedes ver).";
  if (estado === 409 || estado === 412) return "Conflicto: ya existe con ese nombre o la versión no es la última.";
  if (estado >= 500) return "Error del servidor de Trimble.";
  if (estado === 0) return "No hubo respuesta.";
  return `Respuesta ${estado}.`;
}

export interface Carpeta {
  id: string;
  versionId: string | null;
  nombre: string;
  /** The user's access to it: READ or FULL_ACCESS. */
  permiso: string | null;
}

function carpetaDe(r: Respuesta): Carpeta | null {
  const id = campo(r, "id");
  return id ? { id, versionId: campo(r, "versionId"), nombre: campo(r, "name") ?? "", permiso: campo(r, "permission") } : null;
}

export async function leerCarpeta(c: ClienteTrimble, id: string): Promise<{ carpeta: Carpeta | null; respuesta: Respuesta }> {
  const respuesta = await c.pedir("GET", `/folders/${encodeURIComponent(id)}`);
  return { carpeta: ok(respuesta) ? carpetaDe(respuesta) : null, respuesta };
}

/** An item of a folder by its exact name (null: there is none). */
export async function buscarEnCarpeta(c: ClienteTrimble, carpetaId: string, nombre: string, tipo: "FILE" | "FOLDER"): Promise<{ id: string; versionId: string | null } | null> {
  const r = await c.pedir("GET", `/folders/${encodeURIComponent(carpetaId)}/item?name=${encodeURIComponent(nombre)}&type=${tipo}`);
  const id = ok(r) ? campo(r, "id") : null;
  return id ? { id, versionId: campo(r, "versionId") } : null;
}

/**
 * Creates a folder. The API documents parentId as the parent's version id;
 * if that is refused, the folder id is tried (and the result says which worked).
 */
export async function crearCarpeta(c: ClienteTrimble, padre: Carpeta, nombre: string): Promise<{ carpeta: Carpeta | null; respuesta: Respuesta; con: "versionId" | "id" }> {
  const intentos: ("versionId" | "id")[] = padre.versionId && padre.versionId !== padre.id ? ["versionId", "id"] : ["id"];
  let ultimo: { carpeta: Carpeta | null; respuesta: Respuesta; con: "versionId" | "id" } | null = null;
  for (const con of intentos) {
    const parentId = con === "versionId" ? padre.versionId! : padre.id;
    const respuesta = await c.pedir("POST", "/folders", { cuerpo: { name: nombre, parentId } });
    ultimo = { carpeta: ok(respuesta) ? carpetaDe(respuesta) : null, respuesta, con };
    if (ok(respuesta) || respuesta.estado === 401 || respuesta.estado === 403) break;
  }
  return ultimo!;
}

export interface Subida {
  respuesta: Respuesta;
  uploadId: string | null;
  /** Signed URL to PUT the content to (only while UPLOADABLE). */
  url: string | null;
  status: string | null;
  fileId: string | null;
  versionId: string | null;
  revision: number | null;
  errorReason: string | null;
}

function subidaDe(respuesta: Respuesta): Subida {
  const cuerpo = (respuesta.cuerpo ?? {}) as { contents?: { url?: unknown; format?: unknown }[]; revision?: unknown };
  const fuente = Array.isArray(cuerpo.contents) ? cuerpo.contents.find((x) => !x.format) ?? cuerpo.contents[0] : undefined;
  return {
    respuesta,
    uploadId: campo(respuesta, "uploadId"),
    url: typeof fuente?.url === "string" ? fuente.url : null,
    status: campo(respuesta, "status"),
    fileId: campo(respuesta, "fileId"),
    versionId: campo(respuesta, "versionId"),
    revision: typeof cuerpo.revision === "number" ? cuerpo.revision : null,
    errorReason: campo(respuesta, "errorReason"),
  };
}

/**
 * Starts uploading a file to a folder. `soloNuevo`: fail if a file with that
 * name already exists (so a retry never duplicates); otherwise the same name
 * makes a new version (`siVersion`: only if that is still the latest one).
 */
export async function iniciarSubida(c: ClienteTrimble, carpetaId: string, nombre: string, opciones: { soloNuevo?: boolean; siVersion?: string } = {}): Promise<Subida> {
  const encabezados: Record<string, string> = {};
  if (opciones.soloNuevo) encabezados["If-None-Match"] = "*";
  if (opciones.siVersion) encabezados["If-Match"] = opciones.siVersion;
  const respuesta = await c.pedir("POST", `/files/fs/upload?parentId=${encodeURIComponent(carpetaId)}&parentType=FOLDER`, { cuerpo: { name: nombre }, encabezados });
  return subidaDe(respuesta);
}

export async function estadoSubida(c: ClienteTrimble, uploadId: string): Promise<Subida> {
  return subidaDe(await c.pedir("GET", `/files/fs/upload?uploadId=${encodeURIComponent(uploadId)}`));
}

/** Sends the content to the signed URL (PUT, no token, no extra headers). */
export async function enviarContenido(url: string, contenido: string, fetchFn: Fetch = fetch): Promise<number> {
  // A Blob without a type: no Content-Type header, as the signed URL expects.
  const res = await fetchFn(url, { method: "PUT", body: new Blob([contenido]), signal: AbortSignal.timeout(25_000) });
  return res.status;
}

/** The small text file of the test. */
export function contenidoPrueba(quien: string, cuando: string): string {
  return `Prueba de escritura de la extensión Compras y Contratación.\r\nHecha por ${quien} el ${cuando}.\r\nEste archivo y su carpeta se pueden borrar.\r\n`;
}
