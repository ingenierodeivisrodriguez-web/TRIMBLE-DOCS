/**
 * Walking a flow's review folders in Trimble (with the caller's session) to
 * find every file and its latest version. Subfolders that are review folders
 * of a flow (another one, or another of this one) are left to that folder:
 * the closest flow wins. The walk stops at a time and size budget; a folder
 * that can't be read (permissions) or a stop makes it incomplete, and then
 * nothing is retired.
 */
import type { RawFolderItem } from "../trimbleApi";
import { limpiarTexto } from "./flujos";
import { nombrePersona } from "./prueba";
import type { ArchivoVisto, CarpetaFlujo } from "./types";

export interface Limites {
  tiempoMs: number;
  maxCarpetas: number;
  maxArchivos: number;
  /** Folders read at the same time. */
  paralelo: number;
}

export const LIMITES: Limites = { tiempoMs: 50_000, maxCarpetas: 1500, maxArchivos: 5000, paralelo: 6 };

export interface Recorrido {
  vistos: ArchivoVisto[];
  completo: boolean;
  carpetas: number;
  /** Why it is incomplete, in words. */
  motivo: string;
}

export async function recorrer(
  inicio: CarpetaFlujo[],
  /** Review folders of every active flow: not entered from above. */
  excluir: Set<string>,
  deps: { items(folderId: string): Promise<RawFolderItem[]>; reloj(): number },
  limites: Limites = LIMITES
): Promise<Recorrido> {
  const cola = inicio.map((c) => ({ id: c.id, ruta: c.ruta, ancestros: c.ancestros }));
  const leidas = new Set<string>();
  const vistos: ArchivoVisto[] = [];
  const fin = deps.reloj() + limites.tiempoMs;
  const motivos: string[] = [];
  while (cola.length) {
    if (deps.reloj() > fin) {
      motivos.push("se acabó el tiempo de esta revisión");
      break;
    }
    if (leidas.size >= limites.maxCarpetas) {
      motivos.push(`hay más de ${limites.maxCarpetas} carpetas`);
      break;
    }
    const tanda = cola.splice(0, limites.paralelo).filter((c) => !leidas.has(c.id));
    tanda.forEach((c) => leidas.add(c.id));
    const respuestas = await Promise.allSettled(tanda.map((c) => deps.items(c.id)));
    respuestas.forEach((r, i) => {
      const c = tanda[i];
      if (r.status === "rejected") {
        motivos.push(`no se pudo leer «${c.ruta}»`);
        return;
      }
      const ancestros = [...c.ancestros, c.id];
      for (const it of r.value) {
        if (!it || typeof it.id !== "string") continue;
        const nombre = it.name ?? "";
        if (it.type === "FOLDER") {
          if (!excluir.has(it.id) && !leidas.has(it.id)) cola.push({ id: it.id, ruta: `${c.ruta} / ${nombre}`, ancestros });
        } else if (it.type === "FILE") {
          const quien = it.modifiedBy ?? it.createdBy;
          vistos.push({
            fileId: it.id,
            nombre,
            versionId: it.versionId ?? null,
            revision: typeof it.revision === "number" ? it.revision : null,
            subido: it.modifiedOn ?? it.createdOn ?? null,
            subidoPor: limpiarTexto(nombrePersona(quien)),
            subidoPorId: quien?.id ?? null,
            carpetaId: c.id,
            ancestros,
            ruta: `${c.ruta} / ${nombre}`,
          });
        }
      }
    });
    if (vistos.length >= limites.maxArchivos) {
      motivos.push(`hay más de ${limites.maxArchivos} archivos`);
      break;
    }
  }
  return { vistos, completo: motivos.length === 0 && cola.length === 0, carpetas: leidas.size, motivo: motivos.slice(0, 3).join("; ") };
}
