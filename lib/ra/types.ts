import type { EstadoQr } from "./codigo";
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
  puntos: PuntoVista[];
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

/** Where the sheet is stuck: on a wall (owner's decision) or, for the first test QRs, on the floor. */
export type Montaje = "muro" | "piso";

/** A QR: where it goes in the model, which way it faces, until when it opens. */
export interface PuntoGuardado {
  id: string;
  projectId: string;
  modeloId: string;
  /** What the QR holds (never guessable). */
  codigo: string;
  nombre: string;
  /** For whoever sticks the sheet on site: which wall and face (on the floor: where the arrow points). */
  referencia: string;
  montaje: Montaje;
  /** In the prepared model's frame (metres, y up, relative to its origin). */
  punto: Vec3;
  /** Radians from +z towards +x of the model: where the wall face looks (on the floor: the arrow). */
  rumbo: number;
  /** The element the point was taken on. */
  elemento: string;
  vence: string;
  creado: string;
  creadoPor: string | null;
  creadoPorId: string | null;
  anulado: string | null;
  anuladoPor: string | null;
  usos: number;
  ultimoUso: string | null;
}

export type PuntoVista = Omit<PuntoGuardado, "creadoPorId"> & { estado: EstadoQr; url: string; modeloNombre: string; puedeAnular: boolean };

export interface NuevoPunto {
  modeloId: string;
  nombre: string;
  referencia: string;
  montaje: "muro";
  punto: Vec3;
  rumbo: number;
  elemento: string;
  /** Last day it opens, "AAAA-MM-DD" (Colombian time). */
  vence: string;
}

/** What the phone page learns from a QR code (nothing more without a valid one). */
export interface PublicoResponse {
  estado: EstadoQr | "no-existe";
  nombre?: string;
  referencia?: string;
  vence?: string;
  montaje?: Montaje;
  modelo?: { nombre: string; elementos: number; triangulos: number; bytes: number };
}

/** What the phone needs to show the model in AR (only for an active QR on a wall). */
export interface AperturaResponse {
  estado: EstadoQr | "no-existe" | "en-piso";
  /** Short-lived link to the model's file. */
  url?: string;
  /** The QR's point and which way its wall looks, in the model's frame. */
  punto?: Vec3;
  rumbo?: number;
  bytes?: number;
}
