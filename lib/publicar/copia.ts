/**
 * Copying a file's content from one Trimble Connect project to another: the
 * server reads it from the origin's short-lived download link and sends it to
 * the destination's signed upload URL. The browser never carries it, so
 * Vercel's 4.5 MB limit on requests doesn't apply; what limits a copy is the
 * time a server function may run (see maxDuration in the route).
 */
import { formatBytes } from "../format";

type Fetch = typeof fetch;

/** Time a copy may take: the route runs up to 300 s and needs some for the other calls. */
export const TIEMPO_COPIA_MS = 270_000;

/** Above this, a file is never loaded whole in memory (only streamed). */
export const LIMITE_MEMORIA = 512 * 1024 * 1024;

/** Below this, a copy is too short to measure the speed. */
const MINIMO_MEDIBLE = 5 * 1024 * 1024;

export interface Copia {
  ok: boolean;
  /** Status of the PUT to the destination (or of the download, when it failed). */
  http: number;
  bytes: number | null;
  ms: number;
  /** "flujo": passed through as it arrived; "memoria": loaded whole, then sent. */
  metodo: "flujo" | "memoria" | null;
  mensaje: string;
}

const mensajeDe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Copies the content behind `desde` (a download link) to `hacia` (a signed
 * upload URL: PUT, no token, no Content-Type). It streams when the origin
 * gives the size, since the signed URL needs the length up front; if
 * streaming fails, a file up to LIMITE_MEMORIA is downloaded again and sent whole.
 */
export async function copiarContenido(desde: string, hacia: string, fetchFn: Fetch = fetch, reloj: () => number = Date.now): Promise<Copia> {
  const inicio = reloj();
  const senal = AbortSignal.timeout(TIEMPO_COPIA_MS);
  const fin = (ok: boolean, http: number, bytes: number | null, metodo: Copia["metodo"], mensaje: string): Copia => ({ ok, http, bytes, ms: reloj() - inicio, metodo, mensaje });
  const bajar = () => fetchFn(desde, { signal: senal, cache: "no-store" });

  let origen: Response;
  try {
    origen = await bajar();
  } catch (err) {
    return fin(false, 0, null, null, `No se pudo leer el archivo del origen (${mensajeDe(err)}).`);
  }
  if (!origen.ok) return fin(false, origen.status, null, null, `Trimble no entregó el archivo del origen (respuesta ${origen.status}).`);

  const largo = Number(origen.headers.get("content-length"));
  const conLargo = Number.isFinite(largo) && largo > 0 ? largo : null;
  let falloFlujo = "";
  if (conLargo !== null && origen.body) {
    try {
      // `duplex` is required by Node's fetch for a streamed body (not in the DOM types).
      const res = await fetchFn(hacia, { method: "PUT", body: origen.body, headers: { "Content-Length": String(conLargo) }, duplex: "half", signal: senal } as RequestInit & { duplex: "half" });
      const ok = res.ok;
      return fin(ok, res.status, conLargo, "flujo", ok ? "El servidor pasó el archivo al destino a medida que lo leía del origen." : `Trimble no aceptó el archivo en el destino (respuesta ${res.status}).`);
    } catch (err) {
      falloFlujo = mensajeDe(err);
    }
    if (conLargo > LIMITE_MEMORIA) {
      return fin(false, 0, conLargo, "flujo", `No se pudo pasar el archivo por partes (${falloFlujo}) y pesa demasiado (${formatBytes(conLargo)}) para copiarlo de una vez.`);
    }
    try {
      origen = await bajar(); // the first stream was consumed
    } catch (err) {
      return fin(false, 0, null, null, `No se pudo leer otra vez el archivo del origen (${mensajeDe(err)}).`);
    }
    if (!origen.ok) return fin(false, origen.status, null, null, `Trimble no entregó otra vez el archivo del origen (respuesta ${origen.status}).`);
  }

  let datos: Uint8Array;
  try {
    datos = new Uint8Array(await origen.arrayBuffer());
  } catch (err) {
    return fin(false, 0, null, null, `No se pudo leer el archivo del origen (${mensajeDe(err)}).`);
  }
  if (datos.byteLength > LIMITE_MEMORIA) return fin(false, 0, datos.byteLength, "memoria", `El archivo pesa demasiado (${formatBytes(datos.byteLength)}) para copiarlo de una vez.`);
  try {
    // A Blob without a type: no Content-Type header, as the signed URL expects.
    const res = await fetchFn(hacia, { method: "PUT", body: new Blob([datos as BlobPart]), signal: senal });
    const previo = falloFlujo ? ` No se pudo pasar por partes (${falloFlujo}).` : "";
    return fin(res.ok, res.status, datos.byteLength, "memoria", res.ok ? `El servidor cargó el archivo entero y lo envió al destino.${previo}` : `Trimble no aceptó el archivo en el destino (respuesta ${res.status}).${previo}`);
  } catch (err) {
    return fin(false, 0, datos.byteLength, "memoria", `No se pudo enviar el archivo al destino (${mensajeDe(err)}).`);
  }
}

/** "4.2 s", "1 min 05 s". */
export function duracion(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, "0")} s`;
}

/** "12.3 MB/s"; null when the copy was too small or too quick to say. */
export function velocidad(bytes: number | null, ms: number): string | null {
  if (!bytes || bytes < MINIMO_MEDIBLE || ms <= 0) return null;
  return `${formatBytes((bytes * 1000) / ms)}/s`;
}
