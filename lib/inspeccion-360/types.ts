// Inspección 360°: shapes shared by the server, the browser and the tests.

export type Vec3 = [number, number, number];

/** Largest 360° photo accepted (the bucket refuses more too). */
export const MAX_BYTES_FOTO = 60 * 1024 * 1024;
/** Largest thumbnail (data URL) kept in the database. */
export const MAX_MINIATURA = 300_000;
export const CARPETA_INICIAL = "Inspección 360";
export const ALTURA_INICIAL_M = 1.5;

export interface ConfigI360 {
  codigoProyecto: string | null;
  carpetaNombre: string;
  /** Trimble user ids that create points and upload photos besides the project's administrators. */
  editores: string[];
  version: number;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export interface Punto {
  id: string;
  projectId: string;
  codigo: string;
  torre: string;
  piso: string;
  unidad: string;
  numero: number;
  espacio: string;
  zona: string;
  referenciaFisica: string;
  modelId: string;
  versionId: string | null;
  /** Viewer frame, metres, tripod height included in z. */
  x: number;
  y: number;
  z: number;
  alturaM: number;
  rumboGrados: number | null;
  estado: "activo" | "inactivo";
  motivo: string;
  version: number;
  creado: string;
  creadoPor: string;
  creadoPorNombre: string;
  actualizado: string;
  actualizadoPor: string | null;
}

export interface PuntoVista extends Punto {
  /** Ready captures (photo already in the CDE). */
  capturas: number;
  ultimaCaptura: string | null;
}

export type EstadoCaptura = "subiendo" | "lista" | "error" | "anulada";
export type EstadoFoto = "subiendo" | "en_cde" | "error";

export interface Captura {
  id: string;
  projectId: string;
  puntoId: string;
  tomadaEn: string;
  observaciones: string;
  estado: EstadoCaptura;
  motivo: string;
  inspectorId: string;
  inspectorNombre: string;
  creado: string;
  actualizado: string;
  actualizadoPor: string | null;
}

export interface Foto {
  id: string;
  projectId: string;
  capturaId: string;
  tipo: "360" | "convencional";
  nombreArchivo: string;
  nombreOriginal: string;
  tamano: number;
  ancho: number | null;
  alto: number | null;
  miniatura: string;
  rutaTemporal: string | null;
  cdeCarpetaId: string | null;
  cdeFileId: string | null;
  cdeVersionId: string | null;
  estado: EstadoFoto;
  error: string;
  creado: string;
  actualizado: string;
}

/** A capture as the panel lists it: the photo without the temporary path. */
export interface CapturaVista extends Captura {
  foto: Omit<Foto, "rutaTemporal"> | null;
  puedeAnular: boolean;
}

export interface EstadoResponse {
  config: ConfigI360;
  esAdmin: boolean;
  puedeEditar: boolean;
  usuario: { id: string; nombre: string };
  /** False when the server has no Supabase configured (only in memory). */
  almacenamiento: boolean;
}

export interface NuevoPunto {
  torre: string;
  piso: string;
  unidad: string;
  /** Omitted: the next free number of that unit. */
  numero?: number;
  espacio?: string;
  zona?: string;
  referenciaFisica?: string;
  modelId: string;
  versionId?: string | null;
  /** The clicked floor point (viewer frame, metres); the server adds the tripod height. */
  piso3d: Vec3;
  alturaM?: number;
  rumboGrados?: number | null;
}

export interface CambiosPunto {
  version: number;
  espacio?: string;
  zona?: string;
  referenciaFisica?: string;
  alturaM?: number;
  rumboGrados?: number | null;
  /** "inactivo" needs a reason; "activo" brings it back. */
  estado?: "activo" | "inactivo";
  motivo?: string;
}

export interface NuevaSubida {
  puntoId: string;
  /** ISO with offset; from the photo's EXIF or typed by the person. */
  tomadaEn: string;
  observaciones?: string;
  nombreOriginal: string;
  tamano: number;
  ancho?: number | null;
  alto?: number | null;
  miniatura: string;
}

export interface SubidaResponse {
  captura: CapturaVista;
  /** Where the browser PUTs the photo (Supabase Storage, one object, no key). */
  url: string;
}

export interface MiembroProyecto {
  id: string;
  nombre: string;
  esAdmin: boolean;
}
