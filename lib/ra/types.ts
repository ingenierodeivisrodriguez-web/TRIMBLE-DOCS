import type { Filtros, Vec3 } from "./modelo";

export type EstadoModelo = "subiendo" | "listo" | "eliminado";
export type MotivoEliminacion = "vencido" | "manual" | "subida-incompleta";

/** An IFC of Trimble Connect that went into a model. */
export interface ArchivoFuente {
  fileId: string;
  versionId: string;
  nombre: string;
}

export interface ConfigRA {
  diasSinUso: number;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export const DIAS_SIN_USO_INICIAL = 30;
/** A model whose upload never finished is cleaned up after this. */
export const HORAS_SUBIDA_INCOMPLETA = 24;

export interface ModeloGuardado {
  id: string;
  projectId: string;
  nombre: string;
  archivos: ArchivoFuente[];
  filtros: Filtros;
  estado: EstadoModelo;
  /** Where the file is in the bucket (never sent to the browser). */
  ruta: string;
  bytes: number;
  triangulos: number;
  elementos: number;
  origen: Vec3;
  creado: string;
  creadoPor: string | null;
  creadoPorId: string | null;
  ultimoUso: string | null;
  eliminaEn: string | null;
  eliminado: string | null;
  eliminadoPor: string | null;
  motivoEliminacion: MotivoEliminacion | null;
}

/** What the screens get about a model. */
export type ModeloVista = Omit<ModeloGuardado, "ruta" | "creadoPorId"> & { puedeEliminar: boolean };

export interface EstadoResponse {
  config: ConfigRA;
  modelos: ModeloVista[];
  esAdmin: boolean;
  /** False when the server has no Supabase Storage (models cannot be uploaded). */
  almacenamiento: boolean;
}

export interface NuevoModelo {
  nombre: string;
  archivos: ArchivoFuente[];
  filtros: Filtros;
  bytes: number;
  triangulos: number;
  elementos: number;
  origen: Vec3;
}

export interface SubidaResponse {
  modelo: ModeloVista;
  /** Signed URL the browser PUTs the file to (valid for a couple of hours, this object only). */
  urlSubida: string;
}
