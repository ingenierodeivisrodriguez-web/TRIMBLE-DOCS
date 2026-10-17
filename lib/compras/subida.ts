// Browser side of uploading a document to the project's CDE: its fingerprint,
// a local copy until Trimble confirms it, the content sent straight to
// Trimble's signed URL (or through the server for small files), and the
// confirmation. Never stores files on this app's server or database.
import type { ComprasApi } from "./client";
import { MAX_RELEVO } from "./documentos";
import type { Documento, NuevoDocumento } from "./types";

export type Avance = (texto: string) => void;

/** SHA-256 of a file, in hex. */
export async function huella(archivo: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const BASE = "compras-subidas";
const TABLA = "archivos";

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLA);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function operar<T>(modo: IDBTransactionMode, hacer: (t: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await abrirBase();
    return await new Promise<T | null>((resolve) => {
      const r = hacer(db.transaction(TABLA, modo).objectStore(TABLA));
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    // Private windows or blocked storage: the queue just has no local copy.
    return null;
  }
}

/** Files kept in this browser until Trimble confirms them (so a retry doesn't ask for them again). */
export const colaLocal = {
  guardar: (id: string, archivo: Blob) => operar("readwrite", (t) => t.put(archivo, id)),
  leer: (id: string) => operar<Blob>("readonly", (t) => t.get(id) as IDBRequest<Blob>),
  borrar: (id: string) => operar("readwrite", (t) => t.delete(id)),
};

/** Sends the content: straight to Trimble from the browser; if it can't, through the server (up to 4 MB). */
async function enviar(api: ComprasApi, url: string, documentoId: string, archivo: Blob, avance: Avance): Promise<void> {
  avance("Enviando el archivo a Trimble Connect…");
  try {
    // A Blob without a type: no Content-Type header, as the signed URL expects.
    const res = await fetch(url, { method: "PUT", body: new Blob([archivo]) });
    if (res.ok) return;
  } catch {
    // Blocked by the browser (CORS) or the network: try through the server.
  }
  if (archivo.size > MAX_RELEVO) {
    throw new Error("El navegador no pudo enviar el archivo directo a Trimble y pesa más de 4 MB, lo máximo que el servidor puede enviar por ti. Queda pendiente: reinténtalo desde la cola.");
  }
  avance("Enviando el archivo por el servidor…");
  await api.enviarDocumento(documentoId, archivo);
}

/** Asks Trimble to confirm (about 30 s); pending if it is still processing. */
async function confirmar(api: ComprasApi, id: string, avance: Avance): Promise<Documento> {
  avance("Esperando la confirmación de Trimble…");
  let doc: Documento | null = null;
  for (let i = 0; i < 20; i++) {
    doc = (await api.confirmarDocumento(id)).documento;
    if (doc.estado !== "pendiente") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (doc?.estado === "respaldado") await colaLocal.borrar(id);
  return doc!;
}

/** Registers a document of a record and uploads it; returns it as it ended (respaldado, pendiente or error). */
export async function subirDocumento(api: ComprasApi, datos: Omit<NuevoDocumento, "sha256" | "tamano">, archivo: Blob, avance: Avance = () => undefined): Promise<Documento> {
  const id = crypto.randomUUID();
  avance("Calculando la huella del archivo…");
  const sha256 = await huella(archivo);
  await colaLocal.guardar(id, archivo);
  avance("Registrando el documento…");
  const s = await api.crearDocumento({ ...datos, id, sha256, tamano: archivo.size });
  if (!s.url) return s.documento;
  await enviar(api, s.url, id, archivo, avance);
  return confirmar(api, id, avance);
}

/**
 * Retries a document that isn't backed up: Trimble may already have it (then
 * it is only confirmed); otherwise its content is sent again, from this
 * browser's copy or the file the person chooses (it must be the same one).
 */
export async function reintentarSubida(api: ComprasApi, doc: Documento, elegirArchivo: () => Promise<Blob | null>, avance: Avance = () => undefined): Promise<Documento> {
  avance("Preguntando a Trimble…");
  const r = await api.reintentarDocumento(doc.id);
  if (!r.url) {
    if (r.documento.estado === "respaldado") await colaLocal.borrar(doc.id);
    return r.documento;
  }
  const archivo = (await colaLocal.leer(doc.id)) ?? (await elegirArchivo());
  if (!archivo) throw new Error("Elige el archivo original para volver a enviarlo.");
  if ((await huella(archivo)) !== doc.sha256) throw new Error("Ese no es el mismo archivo que se registró: elige el original.");
  await enviar(api, r.url, doc.id, archivo, avance);
  return confirmar(api, doc.id, avance);
}

/** Opens a backed-up document in a new tab with a short-lived link (made with the user's own permissions). */
export async function abrirEnPestana(api: ComprasApi, id: string): Promise<void> {
  const ventana = window.open("", "_blank");
  const { url } = await api.abrirDocumento(id);
  if (ventana) ventana.location.href = url;
  else window.open(url, "_blank");
}
