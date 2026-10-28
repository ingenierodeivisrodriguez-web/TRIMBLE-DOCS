/**
 * Browsing the projects the user belongs to and their folders, with the
 * user's own token (Trimble decides what they can see).
 */
import type { FolderDetails, MyProject, ProjectDetails, RawFolderItem } from "../trimbleApi";
import { esIdTrimble, PublicarError } from "./errores";
import type { CarpetaInfo, ItemCarpeta, ProyectoInfo } from "./types";

/** Trimble Connect through the user's token. */
export interface TcExplorar {
  proyectos(): Promise<MyProject[]>;
  regiones(): Promise<{ name: string; baseUrl: string }[]>;
  proyectosDeRegion(baseUrl: string): Promise<{ id: string; name: string }[]>;
  baseUrl(projectId: string): Promise<string>;
  proyecto(baseUrl: string, projectId: string): Promise<ProjectDetails>;
  carpeta(baseUrl: string, folderId: string): Promise<FolderDetails>;
  items(baseUrl: string, folderId: string): Promise<RawFolderItem[]>;
}

const porNombre = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Every project of the user, the current one first, then by name. The list
 * of memberships (/projects/me) has no names, so they come from each
 * region's project list; a region that fails just leaves its ids unnamed.
 */
export async function listarProyectos(tc: TcExplorar, actual: string): Promise<ProyectoInfo[]> {
  const [lista, regiones] = await Promise.all([tc.proyectos(), tc.regiones().catch(() => [])]);
  const nombres = new Map<string, { nombre: string; region: string }>();
  const listados = await Promise.allSettled(regiones.map(async (r) => ({ region: r.name, proyectos: await tc.proyectosDeRegion(r.baseUrl) })));
  for (const l of listados) {
    if (l.status !== "fulfilled") continue;
    for (const p of l.value.proyectos) if (p.name && !nombres.has(p.id)) nombres.set(p.id, { nombre: p.name, region: l.value.region });
  }
  return lista
    .map((p) => {
      const n = nombres.get(p.id);
      return { id: p.id, nombre: n?.nombre || p.name || p.id, actual: p.id === actual, region: n?.region || p.location };
    })
    .sort((a, b) => Number(b.actual) - Number(a.actual) || porNombre.compare(a.nombre, b.nombre));
}

/** A folder's items as shown: folders first, then files, each by name. */
export function ordenarItems(raw: RawFolderItem[]): ItemCarpeta[] {
  return raw
    .filter((r) => r && typeof r.id === "string" && (r.type === "FOLDER" || r.type === "FILE"))
    .map((r) => ({
      id: r.id,
      nombre: r.name ?? "",
      tipo: r.type === "FOLDER" ? ("carpeta" as const) : ("archivo" as const),
      tamano: r.type === "FILE" && typeof r.size === "number" ? r.size : null,
      revision: r.type === "FILE" && typeof r.revision === "number" ? r.revision : null,
      modificado: r.modifiedOn ?? null,
    }))
    .sort((a, b) => Number(a.tipo === "archivo") - Number(b.tipo === "archivo") || porNombre.compare(a.nombre, b.nombre));
}

/** A folder of a project (its root when no folder is given), with the way down to it. */
export async function verCarpeta(tc: TcExplorar, projectId: string, folderId: string | null): Promise<CarpetaInfo> {
  if (!esIdTrimble(projectId)) throw new PublicarError("El proyecto no es válido.");
  if (folderId !== null && !esIdTrimble(folderId)) throw new PublicarError("La carpeta no es válida.");
  const baseUrl = await tc.baseUrl(projectId);
  const proyecto = await tc.proyecto(baseUrl, projectId);
  const id = folderId ?? proyecto.rootId;
  const [carpeta, raw] = await Promise.all([tc.carpeta(baseUrl, id), tc.items(baseUrl, id)]);
  if (carpeta.projectId && carpeta.projectId !== projectId) throw new PublicarError("Esa carpeta no es de este proyecto.", 404);
  const nombreDe = (x: { id: string; name: string }) => (x.id === proyecto.rootId ? proyecto.name : x.name);
  const ruta = [...carpeta.path.filter((p) => p.id !== carpeta.id), { id: carpeta.id, name: carpeta.name }].map((p) => ({ id: p.id, nombre: nombreDe(p) }));
  return {
    proyecto: { id: projectId, nombre: proyecto.name },
    carpeta: { id: carpeta.id, nombre: nombreDe(carpeta), ruta, permiso: carpeta.permission },
    items: ordenarItems(raw),
  };
}
