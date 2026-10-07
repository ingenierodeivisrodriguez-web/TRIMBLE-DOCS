// "Manuales": reads the documents of the company's manuals folder (in
// another Trimble Connect project) through the technical account (see
// acceso.ts), never outside that folder.
import { buildFileViewerUrl } from "../format";
import type { FileDetails, FolderDetails, RawFolderItem } from "../trimbleApi";
import { TrimbleApiError } from "../trimbleApi";
import type { ConfigManuales } from "./config";
import type { ArchivoResponse, Biblioteca, BusquedaResponse, CarpetaResponse, ItemManual, ResultadoBusqueda } from "./types";

export class ManualesError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

export const SIN_ACCESO = "La cuenta de los manuales no tiene acceso a esta carpeta o archivo en el proyecto de manuales.";

/** Trimble Connect, as the technical account sees it (its token is inside). */
export interface Tc {
  /** The API host of the project's region; fails (404) when the caller isn't a member. */
  baseUrl(projectId: string): Promise<string>;
  project(baseUrl: string, projectId: string): Promise<{ name: string; rootId: string }>;
  folder(baseUrl: string, folderId: string): Promise<FolderDetails>;
  file(baseUrl: string, fileId: string): Promise<FileDetails>;
  items(baseUrl: string, folderId: string): Promise<RawFolderItem[]>;
  downloadUrl(baseUrl: string, fileId: string, options: { versionId?: string; format?: "PDF" }): Promise<string>;
}

export interface Abierta {
  baseUrl: string;
  biblioteca: Biblioteca;
  /** The container's own ancestors, to cut folder paths at it. */
  raiz: boolean;
}

function noVisible(err: unknown): boolean {
  return err instanceof TrimbleApiError && (err.status === 403 || err.status === 404);
}

/** Runs a Trimble call; "can't see it" becomes "sin-acceso". */
async function conAcceso<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (noVisible(err)) throw new ManualesError(SIN_ACCESO, 403, "sin-acceso");
    throw err;
  }
}

/** Opens the manuals folder; throws "sin-acceso" when the account can't reach it. */
export async function abrirBiblioteca(tc: Tc, cfg: ConfigManuales): Promise<Abierta> {
  const baseUrl = await conAcceso(() => tc.baseUrl(cfg.projectId));
  const project = await conAcceso(() => tc.project(baseUrl, cfg.projectId));
  const carpetaId = cfg.folderId ?? project.rootId;
  const carpeta = await conAcceso(() => tc.folder(baseUrl, carpetaId));
  return {
    baseUrl,
    raiz: !cfg.folderId,
    biblioteca: {
      projectId: cfg.projectId,
      projectName: project.name,
      carpetaId,
      carpetaNombre: cfg.folderId ? carpeta.name : project.name,
      permiso: carpeta.permission,
    },
  };
}

const MAX_NIVELES = 40;

/**
 * Whether a folder is the container or lies inside it: its path (or, without
 * one, its chain of parents) goes through the container.
 */
export async function dentroDeBiblioteca(tc: Tc, abierta: Abierta, folderId: string): Promise<boolean> {
  const { carpetaId } = abierta.biblioteca;
  if (folderId === carpetaId || abierta.raiz) return true;
  let id: string | null = folderId;
  for (let nivel = 0; id && nivel < MAX_NIVELES; nivel++) {
    if (id === carpetaId) return true;
    const f: FolderDetails = await conAcceso(() => tc.folder(abierta.baseUrl, id!));
    if (f.path.some((p) => p.id === carpetaId)) return true;
    if (f.path.length > 0) return false; // a full path that doesn't go through it
    id = f.parentId;
  }
  return false;
}

function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 && i < nombre.length - 1 ? nombre.slice(i + 1).toLowerCase() : "";
}

function persona(u?: { firstName?: string; lastName?: string; email?: string }): string {
  if (!u) return "";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "";
}

export function aItem(raw: RawFolderItem): ItemManual {
  const carpeta = raw.type === "FOLDER";
  return {
    id: raw.id,
    nombre: raw.name,
    tipo: carpeta ? "carpeta" : "archivo",
    ext: carpeta ? "" : extension(raw.name),
    tamano: raw.size ?? 0,
    modificado: raw.modifiedOn,
    modificadoPor: persona(raw.modifiedBy),
    versionId: raw.versionId ?? raw.id,
    version: raw.revision ?? 1,
  };
}

function ordenar(items: ItemManual[]): ItemManual[] {
  return items.sort(
    (a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "carpeta" ? -1 : 1) || a.nombre.localeCompare(b.nombre, "es", { numeric: true, sensitivity: "base" })
  );
}

/** A folder of the manuals (the container when none is given), with the path from the container. */
export async function listarCarpeta(tc: Tc, abierta: Abierta, folderId?: string | null): Promise<CarpetaResponse> {
  const { biblioteca, baseUrl } = abierta;
  const id = folderId || biblioteca.carpetaId;
  let ruta = [{ id: biblioteca.carpetaId, nombre: biblioteca.carpetaNombre }];
  if (id !== biblioteca.carpetaId) {
    if (!(await dentroDeBiblioteca(tc, abierta, id))) throw new ManualesError("Esa carpeta no es parte de los manuales.", 404, "fuera");
    const f = await conAcceso(() => tc.folder(baseUrl, id));
    const desde = f.path.findIndex((p) => p.id === biblioteca.carpetaId);
    const tramo = (desde >= 0 ? f.path.slice(desde + 1) : abierta.raiz ? f.path.slice(1) : []).filter((p) => p.id !== id);
    ruta = [...ruta, ...tramo.map((p) => ({ id: p.id, nombre: p.name })), { id, nombre: f.name }];
  }
  const items = await conAcceso(() => tc.items(baseUrl, id));
  return { biblioteca, carpeta: { id, nombre: ruta[ruta.length - 1].nombre, ruta }, items: ordenar(items.map(aItem)) };
}

const MAX_CARPETAS = 400;
const MAX_RESULTADOS = 200;
const CONCURRENCIA = 8;

function plegar(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Files and folders whose name has every word of `q`, anywhere below the
 * container. Folders the caller can't open are skipped; the walk stops at
 * MAX_CARPETAS folders or MAX_RESULTADOS matches.
 */
export async function buscar(tc: Tc, abierta: Abierta, q: string): Promise<BusquedaResponse> {
  const palabras = plegar(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return { resultados: [], completa: true };
  const resultados: ResultadoBusqueda[] = [];
  let visitadas = 0;
  let completa = true;
  let frontera: { id: string; ruta: string[] }[] = [{ id: abierta.biblioteca.carpetaId, ruta: [] }];

  // Level by level, a few folders at a time.
  recorrido: while (frontera.length) {
    const siguiente: typeof frontera = [];
    for (let i = 0; i < frontera.length; i += CONCURRENCIA) {
      if (visitadas >= MAX_CARPETAS || resultados.length >= MAX_RESULTADOS) {
        completa = false;
        break recorrido;
      }
      const lote = frontera.slice(i, i + CONCURRENCIA);
      visitadas += lote.length;
      const listas = await Promise.all(
        lote.map((n) =>
          tc.items(abierta.baseUrl, n.id).catch((err) => {
            if (noVisible(err)) return [] as RawFolderItem[]; // a folder the caller can't open
            throw err;
          })
        )
      );
      lote.forEach((nodo, k) => {
        for (const raw of listas[k]) {
          const item = aItem(raw);
          if (palabras.every((w) => plegar(item.nombre).includes(w))) {
            if (resultados.length < MAX_RESULTADOS) resultados.push({ ...item, carpetaId: nodo.id, ruta: nodo.ruta.join(" / ") });
            else completa = false;
          }
          if (item.tipo === "carpeta") siguiente.push({ id: item.id, ruta: [...nodo.ruta, item.nombre] });
        }
      });
    }
    frontera = siguiente;
  }
  return { resultados: ordenar(resultados) as ResultadoBusqueda[], completa };
}

/**
 * A file of the manuals: checks it is inside the container and returns a
 * fresh link to its content (a PDF rendition when `pdf`), and the link to
 * open it in Trimble Connect.
 */
export async function archivo(tc: Tc, abierta: Abierta, fileId: string, pdf = false): Promise<ArchivoResponse> {
  const { baseUrl, biblioteca } = abierta;
  const f = await conAcceso(() => tc.file(baseUrl, fileId));
  const dentro =
    abierta.raiz ||
    f.parentId === biblioteca.carpetaId ||
    f.path.some((p) => p.id === biblioteca.carpetaId) ||
    (!!f.parentId && (await dentroDeBiblioteca(tc, abierta, f.parentId)));
  if (!dentro) throw new ManualesError("Ese archivo no es parte de los manuales.", 404, "fuera");
  const url = await conAcceso(() => tc.downloadUrl(baseUrl, fileId, { versionId: f.versionId, ...(pdf ? { format: "PDF" as const } : {}) }));
  const ext = extension(f.name);
  return {
    url,
    nombre: f.name,
    ext,
    tamano: f.size,
    versionId: f.versionId,
    enTrimble: buildFileViewerUrl(biblioteca.projectId, { id: fileId, ext, versionId: f.versionId }),
  };
}
