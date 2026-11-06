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
  /** When its folders were last reviewed, and by whom (phase 2). */
  revisado?: string | null;
  revisadoPor?: string | null;
  /** Due date of the milestone, "AAAA-MM-DD" (optional). */
  vence?: string | null;
  /** Free notes about the flow. */
  notas?: string;
}

/** A comment on a flow: only added, never edited or deleted. */
export interface Comentario {
  id: number;
  creado: string;
  flujoId: string;
  texto: string;
  usuario: string | null;
  usuarioId: string | null;
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
  /**
   * flujo-creado · flujo-modificado · flujo-desactivado · flujo-activado · asignacion-agregada · asignacion-quitada ·
   * archivo-detectado · version-reemplazada · nueva-version · archivo-retirado · archivo-reaparecido · archivo-cambio-flujo
   */
  accion: string;
  usuario: string | null;
  usuarioId: string | null;
  detalle: string;
  /** For a file's lines (phase 2 on): which file, which version, and when it happened in Trimble. */
  archivoId?: string | null;
  fileId?: string | null;
  version?: number | null;
  ocurrido?: string | null;
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

// ---------------------------------------------------------------- phase 2

/**
 * State of a file in its flow: pendiente (first version under review),
 * nueva-version (a new version after a decision), aprobado, rechazado (phase
 * 3), retirado (deleted or moved out of the review folders: kept, never deleted).
 */
export type EstadoArchivo = "pendiente" | "nueva-version" | "aprobado" | "rechazado" | "retirado";

/** A file of a review folder as the flow registered it. */
export interface ArchivoRegistro {
  id: string;
  proyecto: string;
  flujoId: string;
  /** Trimble's file id. */
  fileId: string;
  nombre: string;
  /** "Proyecto / Diseño / Arquitectura / modelo.rvt". */
  ruta: string;
  carpetaId: string | null;
  /** Folder ids above the file, root first. */
  ancestros: string[];
  /** Extension in lower case ("rvt", "pdf"…). */
  tipo: string;
  estado: EstadoArchivo;
  /** The flow's steps when this review started: a later change of the flow doesn't touch it. */
  pasos: PasoFlujo[];
  /** Index in `pasos` of the step it waits for. */
  pasoActual: number;
  /** The version under review (the latest one Trimble had when seen). */
  versionId: string | null;
  revision: number | null;
  /** When and by whom that version was uploaded, as Trimble says. */
  subido: string | null;
  subidoPor: string;
  subidoPorId: string | null;
  /** The last approved version (phase 3). */
  versionAprobadaId: string | null;
  revisionAprobada: number | null;
  /** The decisions of this review, step by step (phase 3); emptied when a new review starts. */
  firmas: Firma[];
  /** The copy of the approved version to the destination folder (phase 4); null until the first approval. */
  traslado: Traslado | null;
  detectado: string;
  actualizado: string;
}

/** A decision on one step of a file's review. */
export interface Firma {
  pasoId: string;
  paso: string;
  decision: "aprobado" | "rechazado";
  quien: string;
  quienId: string;
  /** Approved as a project administrator, without having the step assigned. */
  comoAdmin: boolean;
  fecha: string;
  /** The version decided on. */
  revision: number | null;
  versionId: string | null;
  /** Comment on an approval; the reason of a rejection (required). */
  comentario: string;
}

/**
 * Copying the approved version to the destination folder (phase 4):
 * - pendiente: to do (or to do again after an error);
 * - en-curso: an upload was opened and Trimble hasn't confirmed it;
 * - hecho: it is there (`destino*` says which file and version);
 * - diferencia: the destination has a file with that name that didn't come
 *   from the flow (or changed after the last copy): it is only replaced when
 *   the approver or an administrator confirms, seeing `diferencia*`;
 * - error: it couldn't be done (`mensaje` says why); it can be retried.
 */
export interface Traslado {
  estado: "pendiente" | "en-curso" | "hecho" | "diferencia" | "error";
  mensaje: string;
  /** The approved version being (or last) copied. */
  versionId: string | null;
  revision: number | null;
  /** Where: the destination folder (or its subfolder) and its path. */
  carpetaId: string | null;
  carpetaRuta: string;
  /** The open upload, while en-curso. */
  uploadId: string | null;
  /** The last copy the flow made in the destination. */
  destinoFileId: string | null;
  destinoVersionId: string | null;
  destinoRevision: number | null;
  /** Who did it and when. */
  por: string | null;
  porId: string | null;
  fecha: string | null;
  /** The other content seen in the destination (diferencia). */
  diferenciaVersionId: string | null;
  diferenciaTexto: string;
}

/** A Trimble ToDo to send: to whom, its title and text. */
export interface Aviso {
  titulo: string;
  descripcion: string;
  para: { tipo: "persona" | "grupo"; id: string; nombre: string }[];
  /** The registered files it is about. */
  archivos: string[];
}

/** What a folder walk found: a file with its latest version. */
export interface ArchivoVisto {
  fileId: string;
  nombre: string;
  versionId: string | null;
  revision: number | null;
  subido: string | null;
  subidoPor: string;
  subidoPorId: string | null;
  carpetaId: string;
  ancestros: string[];
  ruta: string;
}

/** The result of reviewing one flow's folders. */
export interface ResumenRevision {
  flujoId: string;
  hito: string;
  /** Someone else is reviewing this flow right now. */
  ocupado: boolean;
  /** Every folder was read in time (only then are missing files checked). */
  completo: boolean;
  nuevos: number;
  nuevasVersiones: number;
  retirados: number;
  reaparecidos: number;
  sinCambios: number;
  carpetas: number;
  mensaje: string;
}

/** A registered file as the screens show it. */
export interface ArchivoInfo extends ArchivoRegistro {
  hito: string;
  /** The step it waits for ("Revisa"), or "" when it waits for nobody. */
  pasoNombre: string;
  /** Who has that step on this file (names), closest assignment first. */
  responsables: string[];
  /** Whether the caller is one of them (administrators: always, for pending files). */
  meToca: boolean;
  /** Trimble's viewer at the version under review. */
  enlace: string;
}
