import type { EntradaBitacora, VerificacionBitacora } from "./types";

/**
 * The bitácora's chain: each row keeps the hash of the previous one of its
 * chain (the company's, or "global" for the technical administrator), so a row
 * changed or removed by hand shows up when the chain is checked. PostgreSQL
 * computes it in supabase/control-obra.sql (obra_bitacora_encadenar); this is
 * the same idea for the in-memory store and the checks of the screen.
 */

export const HASH_INICIAL = "0".repeat(64);

/** JSON with the keys sorted, so the same content always gives the same text. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  const o = valor as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}

/** The row as the text that is hashed (fixed order of fields). */
export function filaCanonica(e: Omit<EntradaBitacora, "hash" | "hashAnterior">): string {
  return [
    e.n,
    e.cadena,
    e.creado,
    e.empresaId ?? "",
    e.projectId ?? "",
    e.actorId,
    e.actorNombre,
    e.accion,
    e.modulo,
    e.objetoTipo,
    e.objetoId,
    jsonCanonico(e.cambios),
    e.motivo,
    e.resultado,
    e.origen,
  ].join("|");
}

/** SHA-256 in hex with Web Crypto (works in the server and in the browser). */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashDe(hashAnterior: string, e: Omit<EntradaBitacora, "hash" | "hashAnterior">): Promise<string> {
  return sha256Hex(`${hashAnterior}|${filaCanonica(e)}`);
}

/** Checks a chain in order of position: every row follows the previous one and its hash matches its content. */
export async function verificarCadena(cadena: string, filas: EntradaBitacora[]): Promise<VerificacionBitacora> {
  const orden = [...filas].sort((a, b) => a.n - b.n);
  let anterior = HASH_INICIAL;
  for (let i = 0; i < orden.length; i++) {
    const f = orden[i];
    const { hash, hashAnterior, ...resto } = f;
    if (f.n !== i + 1 || hashAnterior !== anterior || hash !== (await hashDe(hashAnterior, resto))) {
      return { cadena, filas: orden.length, integra: false, rotaEn: f.n };
    }
    anterior = hash;
  }
  return { cadena, filas: orden.length, integra: true, rotaEn: null };
}

/** The chain of a company, or the technical administrator's. */
export function cadenaDe(empresaId: string | null): string {
  return empresaId ?? "global";
}
