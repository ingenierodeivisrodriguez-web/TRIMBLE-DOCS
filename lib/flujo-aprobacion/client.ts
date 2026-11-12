import { createRequester, TokenSource } from "../propiedades/client";
import type { CarpetaInfo } from "../publicar/types";
import type { FiltroTraza, Traza } from "./trazabilidad";
import type { EstadoCorreos } from "./correo";
import type { Pendiente } from "./enlaces";
import type { ArchivoInfo, AvisoPermisos, Comentario, EntradaHistorial, Equipo, EstadoFlujos, PasoPrueba, PermisosCarpeta, PruebaResponse, ResumenRevision, Traslado } from "./types";

export interface DatosFlujoEnvio {
  id?: string;
  version?: number;
  hito: string;
  /** Trimble ids of the chosen files. */
  archivos: string[];
  pasos: { id?: string; nombre: string; responsable: { tipo: "persona" | "grupo"; id: string } | null }[];
  /** "AAAA-MM-DD" or empty. */
  vence?: string;
  notas?: string;
}

export interface FlujoApi {
  /** A folder of this project (its root when no folder is given). */
  carpeta(proyecto: string, folderId?: string | null): Promise<CarpetaInfo>;
  /** One step of the phase 0 test against the real Trimble Connect. */
  prueba(paso: PasoPrueba, datos: Record<string, string>): Promise<PruebaResponse>;
  flujos(): Promise<EstadoFlujos>;
  guardarFlujo(datos: DatosFlujoEnvio): Promise<EstadoFlujos>;
  cambiarEstado(id: string, version: number, activo: boolean): Promise<EstadoFlujos>;
  /** Brings the newer versions of a flow's files in, from the first step (its creator or an administrator). */
  reactivar(id: string, version: number): Promise<EstadoFlujos>;
  equipo(): Promise<Equipo>;
  permisos(flujoId: string): Promise<{ avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] }>;
  historial(flujoId?: string, archivoId?: string): Promise<{ entradas: EntradaHistorial[] }>;
  /** Reads one flow's files in Trimble and registers what changed (phase 2). */
  revisar(flujoId: string): Promise<ResumenRevision>;
  archivos(): Promise<{ yo: string; esAdmin: boolean; archivos: ArchivoInfo[] }>;
  /** Approves or rejects the step a file waits for, on the version seen (phase 3). */
  /** `destino`: the folder where the approved version goes (approving the last step of a flow without destination). */
  decidir(decision: "aprobar" | "rechazar", archivoId: string, versionId: string | null, texto: string, destino?: string | null): Promise<{ mensaje: string; aviso: string | null; traslado: Traslado | null }>;
  /** Copies the approved version (to `carpetaId`, or where it went before), confirms an upload, or replaces a file seen there. */
  traslado(paso: "trasladar" | "confirmar" | "reemplazar", archivoId: string, siVersion?: string | null, carpetaId?: string | null): Promise<{ traslado: Traslado | null; mensaje: string }>;
  /** Each file with what happened to it, for the filter (phase 5). */
  trazabilidad(filtro: Record<string, string>): Promise<{ trazas: Traza[]; filtro: FiltroTraza; hitos: Record<string, string>; por: string }>;
  comentarios(flujoId: string): Promise<{ comentarios: Comentario[] }>;
  comentar(flujoId: string, texto: string): Promise<{ comentarios: Comentario[] }>;
  /** Notes that the caller opened the file from the extension (only the notified person, first time per version). */
  abierto(archivoId: string): Promise<{ anotado: boolean }>;
  /** «Enviar correo de prueba» (administrators): a sample e-mail to the caller's own address. */
  correoPrueba(): Promise<{ mensaje: string }>;
  /** «Correos de aviso» (administrators). */
  correos(): Promise<EstadoCorreos>;
  /** When the extension opens: the flow an e-mail's button asked for (phase 3). */
  pendiente(): Promise<Pendiente>;
  /** Saves them; `config.enlace` is what was pasted as the extension's address. */
  guardarCorreos(config: Record<string, unknown>, version: number): Promise<EstadoCorreos & { mensaje: string }>;
}

/** The HTTP client for /api/flujo-aprobacion, authenticated with the user's Trimble token. */
export function flujoApi(projectId: string, auth: TokenSource): FlujoApi {
  const request = createRequester("/api/flujo-aprobacion", projectId, auth);
  const post = <T>(ruta: string, cuerpo: unknown) => request<T>(ruta, { method: "POST", body: JSON.stringify(cuerpo) });
  return {
    carpeta: (proyecto, folderId) => {
      const q = new URLSearchParams({ proyecto });
      if (folderId) q.set("folderId", folderId);
      return request(`/carpeta?${q.toString()}`);
    },
    prueba: (paso, datos) => post("/prueba", { ...datos, paso }),
    flujos: () => request("/flujos"),
    guardarFlujo: (datos) => post("/flujos", datos),
    cambiarEstado: (id, version, activo) => post("/flujos/estado", { id, version, activo }),
    reactivar: (id, version) => post("/flujos/reactivar", { id, version }),
    equipo: () => request("/equipo"),
    permisos: (flujoId) => request(`/permisos?flujoId=${encodeURIComponent(flujoId)}`),
    historial: (flujoId, archivoId) => {
      const q = new URLSearchParams();
      if (flujoId) q.set("flujoId", flujoId);
      if (archivoId) q.set("archivoId", archivoId);
      const s = q.toString();
      return request(`/historial${s ? `?${s}` : ""}`);
    },
    revisar: (flujoId) => post("/revisar", { flujoId }),
    archivos: () => request("/archivos"),
    decidir: (decision, archivoId, versionId, texto, destino) => post(`/${decision}`, { archivoId, versionId, texto, ...(destino ? { destino } : {}) }),
    traslado: (paso, archivoId, siVersion, carpetaId) => post("/trasladar", { paso, archivoId, ...(siVersion ? { siVersion } : {}), ...(carpetaId ? { carpetaId } : {}) }),
    trazabilidad: (filtro) => {
      const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v));
      const s = q.toString();
      return request(`/trazabilidad${s ? `?${s}` : ""}`);
    },
    comentarios: (flujoId) => request(`/comentarios?flujoId=${encodeURIComponent(flujoId)}`),
    comentar: (flujoId, texto) => post("/comentarios", { flujoId, texto }),
    abierto: (archivoId) => post("/abierto", { archivoId }),
    correoPrueba: () => post("/correo-prueba", {}),
    correos: () => request("/correos"),
    pendiente: () => post("/pendiente", {}),
    guardarCorreos: (config, version) => post("/correos", { config, version }),
  };
}
