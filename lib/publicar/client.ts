import { createRequester, TokenSource } from "../propiedades/client";
import type { CarpetaInfo, CopiaResponse, EntradaActividad, PasoArchivo, PasoCopia, PlanSincronizacion, ProyectoInfo, PublicacionInfo, Recepcion } from "./types";

export interface PublicarApi {
  /** The projects the user belongs to (the current one first). */
  proyectos(): Promise<{ proyectos: ProyectoInfo[] }>;
  /** A folder of one of those projects (its root when no folder is given). */
  carpeta(proyecto: string, folderId?: string | null): Promise<CarpetaInfo>;
  /** One step of copying one file to another project by hand. */
  copia(paso: PasoCopia, datos: Record<string, string>): Promise<CopiaResponse>;
  /** This project's reception folders (as destination). */
  recepciones(): Promise<{ esAdmin: boolean; recepciones: Recepcion[] }>;
  guardarRecepcion(origen: string, carpetaId: string, origenNombre?: string): Promise<{ esAdmin: boolean; recepciones: Recepcion[] }>;
  desactivarRecepcion(origen: string): Promise<{ esAdmin: boolean; recepciones: Recepcion[] }>;
  /** Where publishing from this project to `destino` arrives. */
  recepcionHacia(destino: string): Promise<{ destinoNombre: string; recepcion: Recepcion | null }>;
  publicaciones(): Promise<{ esAdmin: boolean; yo: string; publicaciones: PublicacionInfo[] }>;
  publicar(destino: string, items: { tipo: "archivo" | "carpeta"; id: string }[], nota: string): Promise<{ publicadas: string[]; avisos: string[] }>;
  cambiarEstado(id: string, accion: "detener" | "reanudar"): Promise<{ esAdmin: boolean; yo: string; publicaciones: PublicacionInfo[] }>;
  /** Reviews the publications from or to this project and leaves what to copy. */
  plan(): Promise<PlanSincronizacion>;
  /** Copies one followed file, confirms its upload, or replaces a difference (with the version seen). */
  pasoArchivo(paso: "copiar" | "confirmar" | "reemplazar", archivoId: string, siVersion?: string): Promise<PasoArchivo>;
  actividad(desde?: string, hasta?: string): Promise<{ entradas: EntradaActividad[] }>;
}

/** The HTTP client for /api/publicar, authenticated with the user's Trimble token. */
export function publicarApi(projectId: string, auth: TokenSource): PublicarApi {
  const request = createRequester("/api/publicar", projectId, auth);
  const post = <T>(ruta: string, cuerpo: unknown, method = "POST") => request<T>(ruta, { method, body: JSON.stringify(cuerpo) });
  return {
    proyectos: () => request("/proyectos"),
    carpeta: (proyecto, folderId) => {
      const q = new URLSearchParams({ proyecto });
      if (folderId) q.set("folderId", folderId);
      return request(`/carpeta?${q.toString()}`);
    },
    copia: (paso, datos) => post("/copia", { ...datos, paso }),
    recepciones: () => request("/recepciones"),
    guardarRecepcion: (origen, carpetaId, origenNombre) => post("/recepciones", { origen, carpetaId, origenNombre }, "PUT"),
    desactivarRecepcion: (origen) => post("/recepciones/desactivar", { origen }),
    recepcionHacia: (destino) => request(`/recepcion?destino=${encodeURIComponent(destino)}`),
    publicaciones: () => request("/publicaciones"),
    publicar: (destino, items, nota) => post("/publicaciones", { destino, items, nota }),
    cambiarEstado: (id, accion) => post("/publicaciones/estado", { id, accion }),
    plan: () => post("/sincronizar", { paso: "plan" }),
    pasoArchivo: (paso, archivoId, siVersion) => post("/sincronizar", { paso, archivoId, ...(siVersion ? { siVersion } : {}) }),
    actividad: (desde, hasta) => {
      const q = new URLSearchParams();
      if (desde) q.set("desde", desde);
      if (hasta) q.set("hasta", hasta);
      const s = q.toString();
      return request(`/actividad${s ? `?${s}` : ""}`);
    },
  };
}
