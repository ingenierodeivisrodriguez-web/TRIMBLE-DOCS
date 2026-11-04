/**
 * Phase 0 of "Flujo de aprobación": one request per step of the test against
 * the real Trimble Connect.
 * - equipo: the project's people and groups, and who belongs to each group.
 * - archivo: a file's versions (who uploaded each one) and direct links.
 * - copiar: its latest version to another folder of the same project.
 * - estado-subida / estado-visor: following that copy.
 * - tarea: a ToDo assigned to a person or group, with the file attached.
 */
export type PasoPrueba = "equipo" | "archivo" | "copiar" | "estado-subida" | "estado-visor" | "tarea";

export const PASOS_PRUEBA: PasoPrueba[] = ["equipo", "archivo", "copiar", "estado-subida", "estado-visor", "tarea"];

export interface PruebaResponse {
  paso: PasoPrueba;
  ok: boolean;
  mensaje: string;
  datos: Record<string, unknown>;
}

/** The title every test ToDo starts with, so it is easy to find and delete. */
export const TAREA_PRUEBA = "Prueba Flujo de aprobación";

export interface PersonaEquipo {
  id: string;
  nombre: string;
  email: string;
  admin: boolean;
  /** Invited and not joined yet. */
  pendiente: boolean;
}

export interface GrupoEquipo {
  id: string;
  nombre: string;
  /** Names of its members; null when Trimble didn't give them. */
  miembros: string[] | null;
  /** How many members Trimble says it has, when it says. */
  total: number | null;
}

export interface VersionTrimble {
  versionId: string;
  revision: number | null;
  /** Who uploaded this version (modifiedBy, else createdBy). */
  subio: string;
  /** createdBy, when it differs from `subio`. */
  creo: string;
  fecha: string | null;
  tamano: number | null;
}

export interface IntentoTrimble {
  formato: string;
  http: number;
  /** Trimble's answer when it refused (cut short). */
  detalle: string;
}

// ---------------------------------------------------------------- phase 1

/** Steps after "Realiza" (who uploads): at least one, at most this many. */
export const MIN_PASOS = 1;
export const MAX_PASOS = 5;
/** Review folders of one flow. */
export const MAX_CARPETAS = 20;

/** A review step of a flow ("Revisa", "Aprueba"…). The id stays when it is renamed. */
export interface PasoFlujo {
  id: string;
  nombre: string;
}

/** A Trimble folder as the flow keeps it: its path, and the ids above it (root first). */
export interface CarpetaFlujo {
  id: string;
  ruta: string;
  ancestros: string[];
}

/** An approval flow: its title or milestone, review folders, destination and steps. Never deleted: deactivated. */
export interface Flujo {
  id: string;
  proyecto: string;
  hito: string;
  /** The title normalized, so it doesn't repeat in the project. */
  hitoClave: string;
  pasos: PasoFlujo[];
  carpetas: CarpetaFlujo[];
  destino: CarpetaFlujo;
  activo: boolean;
  version: number;
  creado: string;
  creadoPor: string | null;
  actualizado: string;
  actualizadoPor: string | null;
}

/** "realiza" (uploads and corrects), "consulta" (only sees), or the id of a review step. */
export type Papel = string;

/** Who does what on a folder or file of a flow. Never deleted: deactivated. */
export interface Asignacion {
  id: string;
  flujoId: string;
  proyecto: string;
  objetivoTipo: "carpeta" | "archivo";
  objetivoId: string;
  objetivoRuta: string;
  /** Folder ids above the target, root first. */
  objetivoAncestros: string[];
  papel: Papel;
  quienTipo: "persona" | "grupo";
  quienId: string;
  quienNombre: string;
  activa: boolean;
  creado: string;
  creadoPor: string | null;
}

/** One line of the history (only added, never changed). */
export interface EntradaHistorial {
  id: number;
  creado: string;
  proyecto: string;
  flujoId: string | null;
  /** flujo-creado · flujo-modificado · flujo-desactivado · flujo-activado · asignacion-agregada · asignacion-quitada */
  accion: string;
  usuario: string | null;
  usuarioId: string | null;
  detalle: string;
}

/** What the screen gets: flows with their assignments, and whether the caller administers them. */
export interface EstadoFlujos {
  esAdmin: boolean;
  yo: string;
  flujos: (Flujo & { asignaciones: Asignacion[] })[];
}

/** The project's team as Trimble lists it, for picking who does what. */
export interface Equipo {
  personas: PersonaEquipo[];
  grupos: { id: string; nombre: string }[];
}

export interface AvisoPermisos {
  tipo: "riesgo" | "falla" | "info";
  texto: string;
}

/** Who Trimble lists with access to one folder, in words. */
export interface PermisosCarpeta {
  ruta: string;
  papel: "destino" | "revision";
  completo: string[];
  lectura: string[];
  sinAcceso: string[];
}
