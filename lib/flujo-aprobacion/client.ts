import { createRequester, TokenSource } from "../propiedades/client";
import type { CarpetaInfo } from "../publicar/types";
import type { ArchivoInfo, AvisoPermisos, EntradaHistorial, Equipo, EstadoFlujos, PasoPrueba, PermisosCarpeta, PruebaResponse, ResumenRevision } from "./types";

export interface DatosFlujoEnvio {
  id?: string;
  version?: number;
  hito: string;
  carpetas: string[];
  destino: string;
  pasos: { id?: string; nombre: string }[];
  /** Deactivate the assignments the change leaves without sense. */
  confirmar?: boolean;
}

export interface FlujoApi {
  /** A folder of this project (its root when no folder is given). */
  carpeta(proyecto: string, folderId?: string | null): Promise<CarpetaInfo>;
  /** One step of the phase 0 test against the real Trimble Connect. */
  prueba(paso: PasoPrueba, datos: Record<string, string>): Promise<PruebaResponse>;
  flujos(): Promise<EstadoFlujos>;
  guardarFlujo(datos: DatosFlujoEnvio): Promise<EstadoFlujos>;
  cambiarEstado(id: string, version: number, activo: boolean): Promise<EstadoFlujos>;
  equipo(): Promise<Equipo>;
  asignar(datos: { flujoId: string; objetivos: { tipo: "carpeta" | "archivo"; id: string }[]; quien: { tipo: "persona" | "grupo"; id: string }; papel: string }): Promise<EstadoFlujos & { mensaje: string }>;
  quitarAsignacion(id: string): Promise<EstadoFlujos>;
  permisos(flujoId: string): Promise<{ avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] }>;
  historial(flujoId?: string, archivoId?: string): Promise<{ entradas: EntradaHistorial[] }>;
  /** Walks one flow's review folders and registers what changed (phase 2). */
  revisar(flujoId: string): Promise<ResumenRevision>;
  archivos(): Promise<{ yo: string; esAdmin: boolean; archivos: ArchivoInfo[] }>;
  /** Approves or rejects the step a file waits for, on the version seen (phase 3). */
  decidir(decision: "aprobar" | "rechazar", archivoId: string, versionId: string | null, texto: string): Promise<{ mensaje: string; aviso: string | null }>;
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
    equipo: () => request("/equipo"),
    asignar: (datos) => post("/asignaciones", datos),
    quitarAsignacion: (id) => post("/asignaciones/quitar", { id }),
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
    decidir: (decision, archivoId, versionId, texto) => post(`/${decision}`, { archivoId, versionId, texto }),
  };
}
