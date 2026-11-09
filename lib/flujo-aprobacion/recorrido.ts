/**
 * Reading a flow's chosen files in Trimble (with the caller's session) to find
 * each one's latest version and who uploaded it. Files are read by folder: one
 * listing per folder where they were last seen. A file that isn't there any
 * more (moved) is looked up by itself; Trimble saying it doesn't exist (404)
 * is kept apart from a file that couldn't be read now (permissions, an error,
 * out of time), because only the first may lead to retiring it.
 */
import type { RawFolderItem } from "../trimbleApi";
import { limpiarTexto } from "./flujos";
import { nombrePersona } from "./prueba";
import type { ArchivoVisto, CarpetaFlujo } from "./types";

export interface Limites {
  tiempoMs: number;
  /** Folders (or files) read at the same time. */
  paralelo: number;
}

export const LIMITES: Limites = { tiempoMs: 50_000, paralelo: 6 };

export interface Lectura {
  vistos: ArchivoVisto[];
  /** Files Trimble says don't exist (404). */
  borrados: string[];
  /** Files that couldn't be read now. */
  fallidos: string[];
  completo: boolean;
  /** Folders listed. */
  carpetas: number;
  /** Why it is incomplete, in words. */
  motivo: string;
}

export interface DepsLectura {
  items(folderId: string): Promise<RawFolderItem[]>;
  /** Where a file is now: its path and the folders above it. Throws with status 404 when it doesn't exist. */
  archivo(fileId: string): Promise<CarpetaFlujo>;
  reloj(): number;
}

const padre = (x: CarpetaFlujo) => x.ancestros[x.ancestros.length - 1] ?? null;
/** "Obra / Diseño / modelo.rvt" → "Obra / Diseño". */
const rutaCarpeta = (x: CarpetaFlujo) => {
  const i = x.ruta.lastIndexOf(" / ");
  return i > 0 ? x.ruta.slice(0, i) : x.ruta;
};
const enLista = (items: RawFolderItem[] | null, id: string) => items?.find((x) => x && x.id === id && x.type === "FILE") ?? null;

/** A file of a folder listing, with who uploaded its latest version and when. */
export function vistoDe(it: RawFolderItem, carpeta: CarpetaFlujo): ArchivoVisto {
  const quien = it.modifiedBy ?? it.createdBy;
  const nombre = it.name ?? "";
  return {
    fileId: it.id,
    nombre,
    versionId: it.versionId ?? null,
    revision: typeof it.revision === "number" ? it.revision : null,
    subido: it.modifiedOn ?? it.createdOn ?? null,
    subidoPor: limpiarTexto(nombrePersona(quien)),
    subidoPorId: quien?.id ?? null,
    carpetaId: carpeta.id,
    ancestros: [...carpeta.ancestros, carpeta.id],
    ruta: `${carpeta.ruta} / ${nombre}`,
  };
}

/** Reads these files (each with where it was last seen) and says what Trimble has now. */
export async function leerArchivos(elegidos: CarpetaFlujo[], deps: DepsLectura, limites: Limites = LIMITES): Promise<Lectura> {
  const fin = deps.reloj() + limites.tiempoMs;
  const vistos = new Map<string, ArchivoVisto>();
  const borrados: string[] = [];
  const fallidos = new Set<string>();
  const motivos = new Set<string>();
  const listados = new Map<string, Promise<RawFolderItem[] | null>>();
  const listar = (folderId: string) => {
    if (!listados.has(folderId)) listados.set(folderId, deps.items(folderId).catch(() => null));
    return listados.get(folderId)!;
  };
  const sinTiempo = (resto: CarpetaFlujo[]) => {
    resto.forEach((a) => fallidos.add(a.id));
    motivos.add("se acabó el tiempo de esta revisión");
  };

  const unicos = [...new Map(elegidos.map((a) => [a.id, a])).values()];
  const porCarpeta = new Map<string, CarpetaFlujo[]>();
  const buscar: CarpetaFlujo[] = [];
  for (const a of unicos) {
    const p = padre(a);
    if (p) porCarpeta.set(p, [...(porCarpeta.get(p) ?? []), a]);
    else buscar.push(a);
  }

  // 1. One listing per folder where the files were last seen.
  const carpetas = [...porCarpeta];
  for (let i = 0; i < carpetas.length; i += limites.paralelo) {
    if (deps.reloj() > fin) {
      sinTiempo(carpetas.slice(i).flatMap(([, as]) => as));
      break;
    }
    const tanda = carpetas.slice(i, i + limites.paralelo);
    const listas = await Promise.all(tanda.map(([id]) => listar(id)));
    tanda.forEach(([id, as], j) => {
      const carpeta = { id, ruta: rutaCarpeta(as[0]), ancestros: as[0].ancestros.slice(0, -1) };
      for (const a of as) {
        const it = enLista(listas[j], a.id);
        if (it) vistos.set(a.id, vistoDe(it, carpeta));
        else buscar.push(a);
      }
    });
  }

  // 2. A file not found where it was: where is it now (or is it gone)?
  for (let i = 0; i < buscar.length; i += limites.paralelo) {
    if (deps.reloj() > fin) {
      sinTiempo(buscar.slice(i));
      break;
    }
    await Promise.all(
      buscar.slice(i, i + limites.paralelo).map(async (a) => {
        try {
          const e = await deps.archivo(a.id);
          const p = padre(e);
          const it = p ? enLista(await listar(p), a.id) : null;
          if (it && p) vistos.set(a.id, vistoDe(it, { id: p, ruta: rutaCarpeta(e), ancestros: e.ancestros.slice(0, -1) }));
          else {
            fallidos.add(a.id);
            motivos.add(`no se pudo leer «${e.ruta}»`);
          }
        } catch (err) {
          if ((err as { status?: number }).status === 404) borrados.push(a.id);
          else {
            fallidos.add(a.id);
            motivos.add(`no se pudo leer «${a.ruta}»`);
          }
        }
      })
    );
  }

  return {
    vistos: unicos.map((a) => vistos.get(a.id)).filter((v): v is ArchivoVisto => !!v),
    borrados,
    fallidos: [...fallidos],
    completo: fallidos.size === 0,
    carpetas: listados.size,
    motivo: [...motivos].slice(0, 3).join("; "),
  };
}
