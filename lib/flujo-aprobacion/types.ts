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
