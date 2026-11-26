/**
 * Several approved versions put in one folder, one request per file, with the
 * progress on screen (26-11-2026: after approving several at once, phase 1,
 * and «Poner los seleccionados en una carpeta», phase 2). Each request copies
 * one file, so many files don't run out of time; the server checks each one
 * as when it is put in a folder alone.
 */
import type { ArchivoRegistro, Traslado } from "./types";

/** An approved version of a flow without destination that isn't in a folder yet (or whose copy failed): it can be put in one. */
export function esperaCarpeta(a: Pick<ArchivoRegistro, "versionAprobadaId" | "estado" | "traslado"> & { destino: string | null }): boolean {
  if (a.destino || !a.versionAprobadaId || a.estado === "retirado") return false;
  const t = a.traslado;
  return !(t && t.versionId === a.versionAprobadaId && (t.estado === "hecho" || t.estado === "en-curso"));
}

export interface Copia {
  archivoId: string;
  nombre: string;
  carpetaId: string | null;
}

export interface ResumenCopias {
  /** Copied, or being received by Trimble (it confirms itself). */
  hechas: number;
  total: number;
  /** «nombre: motivo» for each one that didn't go (a file with that name there, an error…). */
  problemas: string[];
  /** Why the rest weren't tried: the folder or the session failed for all of them. */
  detenido: string | null;
}

const PARA_TODOS = new Set(["sin-acceso"]);

/** Whether an error is about the folder or the session, not about one file: the next ones would fail the same way. */
function frenaTodo(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown } | null;
  return (typeof e?.code === "string" && PARA_TODOS.has(e.code)) || e?.status === 401;
}

const motivo = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Copies the list one after the other with `copiarUno` (the `trasladar`
 * request). One that fails doesn't stop the others, except when the folder is
 * refused (read-only) or the session ended: then nothing else is tried.
 */
export async function copiarUnoPorUno(
  lista: Copia[],
  copiarUno: (c: Copia) => Promise<{ traslado: Traslado | null; mensaje: string }>,
  avance?: (n: number, de: number, nombre: string) => void
): Promise<ResumenCopias> {
  const r: ResumenCopias = { hechas: 0, total: lista.length, problemas: [], detenido: null };
  for (const [i, c] of lista.entries()) {
    avance?.(i + 1, lista.length, c.nombre);
    try {
      const { traslado, mensaje } = await copiarUno(c);
      if (traslado && (traslado.estado === "hecho" || traslado.estado === "en-curso")) r.hechas++;
      else r.problemas.push(`${c.nombre}: ${mensaje}`);
    } catch (err) {
      if (frenaTodo(err)) {
        r.detenido = motivo(err);
        break;
      }
      r.problemas.push(`${c.nombre}: ${motivo(err)}`);
    }
  }
  return r;
}

/** «Se copiaron 10 de 12 a «Obra / Aprobados».» (empty when there was nothing to copy). */
export function textoCopias(r: ResumenCopias, ruta?: string): string {
  if (!r.total) return "";
  const donde = ruta ? `a «${ruta}»` : "a la carpeta";
  const base = r.hechas === 0 ? `No se copió ninguno ${donde}.` : `Se ${r.hechas === 1 ? "copió" : "copiaron"} ${r.hechas} de ${r.total} ${donde}.`;
  return r.detenido ? `${base} ${r.detenido}` : base;
}
