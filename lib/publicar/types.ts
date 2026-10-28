/** What the browser and the server of "Publicar entre proyectos" exchange. */

export interface ProyectoInfo {
  id: string;
  nombre: string;
  /** The project the extension is open in. */
  actual: boolean;
  /** Its region, as Trimble names it ("northAmerica", "europe"...). */
  region: string;
}

export interface ItemCarpeta {
  id: string;
  nombre: string;
  tipo: "carpeta" | "archivo";
  /** Bytes (files only). */
  tamano: number | null;
  /** Number of the latest version (files only). */
  revision: number | null;
  modificado: string | null;
}

export interface CarpetaInfo {
  proyecto: { id: string; nombre: string };
  carpeta: {
    id: string;
    nombre: string;
    /** From the project's root down to this folder (both included). */
    ruta: { id: string; nombre: string }[];
    /** The user's access to it. */
    permiso: "READ" | "FULL_ACCESS" | null;
  };
  /** Folders first, then files, each by name. */
  items: ItemCarpeta[];
}

/**
 * The steps of copying one file to another project, one request each:
 * compare it with what the destination folder has, copy its latest
 * version, follow the upload, and ask how the destination's viewer
 * conversion is going.
 */
export type PasoCopia = "revisar" | "copiar" | "estado-subida" | "estado-visor";

export const PASOS_COPIA: PasoCopia[] = ["revisar", "copiar", "estado-subida", "estado-visor"];

/**
 * What the destination folder has under the file's name: nothing ("nuevo"),
 * the same content ("al-dia") or something else ("distinto", which is only
 * replaced when the person says so).
 */
export type Situacion = "nuevo" | "al-dia" | "distinto";

export interface CopiaResponse {
  paso: PasoCopia;
  ok: boolean;
  /** What happened, in plain words. */
  mensaje: string;
  datos: Record<string, unknown>;
}

// ---------------------------------------------------------------- publishing

/** The folder of this project (destination) where an origin project's publications arrive. */
export interface Recepcion {
  id: string;
  destinoProyecto: string;
  origenProyecto: string;
  origenNombre: string;
  /** This project's name, so publishers who aren't members of it can see where they publish. */
  destinoNombre: string;
  carpetaId: string;
  carpetaRuta: string;
  activa: boolean;
  actualizado: string;
  actualizadoPor: string | null;
  actualizadoPorId: string | null;
}

export type EstadoPublicacion = "activa" | "detenida" | "retirada";

export interface Publicacion {
  id: string;
  origenProyecto: string;
  origenNombre: string;
  destinoProyecto: string;
  destinoNombre: string;
  tipo: "archivo" | "carpeta";
  /** The file or folder id in the origin. */
  itemId: string;
  nombre: string;
  ruta: string;
  estado: EstadoPublicacion;
  /** Where it lives in the destination (set with the first copy). */
  destinoCarpetaId: string | null;
  destinoCarpetaRuta: string;
  nota: string;
  publicado: string;
  publicadoPor: string | null;
  publicadoPorId: string | null;
  revisado: string | null;
}

export type EstadoArchivo = "pendiente" | "al-dia" | "diferencia" | "retirado" | "error";

/** A file a publication follows, and the last version copied. */
export interface ArchivoSeguido {
  id: string;
  publicacionId: string;
  origenFileId: string;
  nombre: string;
  /** Subfolder inside the published folder ("Estructura/Detalles"); "" at its top. */
  subcarpeta: string;
  origenVersionId: string | null;
  origenRevision: number | null;
  destinoFileId: string | null;
  destinoVersionId: string | null;
  destinoRevision: number | null;
  estado: EstadoArchivo;
  mensaje: string;
  enCursoHasta: string | null;
  copiandoUploadId: string | null;
  copiandoVersionId: string | null;
  copiandoRevision: number | null;
  /** The destination version seen when it turned out different (only that one is replaced). */
  diferenciaVersionId: string | null;
  actualizado: string;
}

export type AccionActividad =
  | "recepcion"
  | "recepcion-desactivada"
  | "publicar"
  | "copiar"
  | "actualizar"
  | "diferencia"
  | "reemplazar"
  | "retirado"
  | "detener"
  | "reanudar"
  | "error";

export interface EntradaActividad {
  id: number;
  creado: string;
  origenProyecto: string;
  destinoProyecto: string;
  origenNombre: string;
  destinoNombre: string;
  publicacionId: string | null;
  accion: AccionActividad;
  usuario: string | null;
  usuarioId: string | null;
  nombre: string;
  versionOrigen: number | null;
  versionDestino: number | null;
  nota: string;
  resultado: "ok" | "aviso" | "error";
}

/** A publication with its files, as the screens show it. */
export interface PublicacionInfo extends Publicacion {
  archivos: ArchivoSeguido[];
}

/** One file to copy now, as the review of the publications leaves it. */
export interface Tarea {
  archivoId: string;
  publicacionId: string;
  nombre: string;
  subcarpeta: string;
  /** "nuevo": never copied; "version": the origin has a newer version. */
  motivo: "nuevo" | "version";
}

export interface PlanSincronizacion {
  tareas: Tarea[];
  /** What couldn't be reviewed and why (no reception folder, no access to the other project...). */
  avisos: string[];
  /** Files that differ in the destination and wait for someone to decide. */
  diferencias: number;
  revisadas: number;
}

/** The answer to copying (or confirming) one followed file. */
export interface PasoArchivo {
  ok: boolean;
  mensaje: string;
  /** Done (nothing to wait for). */
  listo?: boolean;
  /** An upload Trimble still has to confirm ("confirmar"). */
  uploadId?: string;
  /** Someone else is copying it right now. */
  ocupado?: boolean;
  /** The destination has another content: a person decides. */
  diferencia?: boolean;
}

/** A project one can publish to: one of the user's, or one whose reception folder expects this project. */
export interface DestinoInfo {
  id: string;
  nombre: string;
  /** The user belongs to it (otherwise only the technical account copies there). */
  miembro: boolean;
  recepcion: Recepcion | null;
}

/** The technical account as everyone sees it (never its tokens). */
export interface CuentaInfo {
  conectada: boolean;
  email: string;
  nombre: string;
  conectadaEn: string | null;
  renovadaEn: string | null;
  conectadaPor: string | null;
  /** This person may connect or disconnect it (their id is in PUBLICAR_ADMINS). */
  administra: boolean;
  /** Their Trimble user id, to add it to PUBLICAR_ADMINS. */
  miId: string;
  /** What the server is missing to use it at all. */
  faltan: string[];
}

/** One check of what the technical account can do in this project. */
export interface Comprobacion {
  que: string;
  ok: boolean;
  mensaje: string;
}

/** The step of reviewing and copying the publications (the browser runs them in order). */
export type PasoSincronizar = "plan" | "copiar" | "confirmar" | "reemplazar";
