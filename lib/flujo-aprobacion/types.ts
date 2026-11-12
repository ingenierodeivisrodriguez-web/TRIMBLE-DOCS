/**
 * Phase 0 of "Flujo de aprobación": one request per step of the test against
 * the real Trimble Connect.
 * - equipo: the project's people and groups, and who belongs to each group.
 * - archivo: a file's versions (who uploaded each one) and direct links.
 * - copiar: its latest version to another folder of the same project.
 * - estado-subida / estado-visor: following that copy.
 * - tarea: a ToDo assigned to a person or group, with the file attached.
 */
import type { DatosCorreo } from "./correo";

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
/** Files chosen in one flow. */
export const MAX_ARCHIVOS = 100;

/** A person or group of the project's Trimble team, with the name Trimble gave. */
export interface Responsable {
  tipo: "persona" | "grupo";
  id: string;
  nombre: string;
}

/** A review step of a flow ("Revisa", "Aprueba"…) and who is responsible for it. The id stays when it is renamed. */
export interface PasoFlujo {
  id: string;
  nombre: string;
  /** Who reviews or approves this step (09-11-2026 on; older flows may have none). */
  responsable?: Responsable | null;
}

/** A Trimble folder or file as the flow keeps it: its path, and the folder ids above it (root first). */
export interface CarpetaFlujo {
  id: string;
  ruta: string;
  ancestros: string[];
}

/** A file chosen for a flow: same shape as a folder (the last ancestor is its folder). */
export type ArchivoFlujo = CarpetaFlujo;

/**
 * An approval flow: its title or milestone, the files chosen by whoever
 * created it and its steps, each with its responsible. Never deleted:
 * deactivated.
 */
export interface Flujo {
  id: string;
  proyecto: string;
  hito: string;
  /** The title normalized, so it doesn't repeat in the project. */
  hitoClave: string;
  pasos: PasoFlujo[];
  /** The files that go through the flow (their new versions are detected; a new file is added by editing the flow). */
  archivos: ArchivoFlujo[];
  /** Review folders of flows made before 09-11-2026 (kept, no longer used to find files). */
  carpetas: CarpetaFlujo[];
  /** Destination of flows made before 09-11-2026; new flows have none (the approver will choose). */
  destino: CarpetaFlujo | null;
  activo: boolean;
  version: number;
  creado: string;
  creadoPor: string | null;
  /** Who created it (Trimble id): they and the project administrators change it. */
  creadoPorId?: string | null;
  actualizado: string;
  actualizadoPor: string | null;
  /** When its folders were last reviewed, and by whom (phase 2). */
  revisado?: string | null;
  revisadoPor?: string | null;
  /** Due date of the milestone, "AAAA-MM-DD" (optional). */
  vence?: string | null;
  /** Free notes about the flow (shown as «Descripción»). */
  notas?: string;
  /** Its number in the project, in creation order (11-11-2026): shown as «FLUJO-01». Set by the database. */
  codigo?: number | null;
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

/** What the screen gets: the flows, who is asking and whether they administer the project. */
export interface EstadoFlujos {
  esAdmin: boolean;
  yo: string;
  flujos: Flujo[];
  /** The flows closed by a first decision, by flow id. */
  cierres: Record<string, Cierre>;
  /** After saving: what registering its files did (or why it waits for the next review). */
  mensaje?: string;
}

/**
 * A flow's first decision (a step approved, an approval or a rejection, on any
 * of its files): from then on nobody edits, activates or deactivates the flow
 * (owner's request of 09-11-2026). It keeps reviewing new versions of its files.
 */
export interface Cierre {
  /** When, as the history recorded it. */
  fecha: string;
  quien: string;
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
  /** "revision": a folder with files of the flow; "destino": the destination of an older flow. */
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
  /**
   * The newest version Trimble has, when it isn't the one this flow reviews:
   * since 10-11-2026 a flow keeps the version it was given and only shows this
   * (owner: "el flujo debe conservar que el documento del flujo es versión 4,
   * pero sí debería aparecer un mensaje diciendo que existe una nueva versión").
   */
  versionNueva?: VersionNueva | null;
  /** The Trimble ToDos the flow created about this file (since 10-11-2026), to close them when they are done. */
  tareas?: TareaTrimble[];
  detectado: string;
  actualizado: string;
}

/**
 * A Trimble ToDo the flow created: "revision" asks a step's responsible to
 * decide a version; "correccion" asks the uploader to fix a rejected one. It is
 * closed when none of its files still waits for what it asked (owner,
 * 10-11-2026: "que la tarea creada en Trimble cambie a estado cerrado cuando
 * el flujo sea aprobado o rechazado").
 */
export interface TareaTrimble {
  id: string;
  tipo: "revision" | "correccion";
  /** The step it asks for (revision). */
  pasoId: string | null;
  /** The version it is about. */
  versionId: string | null;
  titulo: string;
  /** The code Trimble shows on it («FLUJO-01», «FLUJO-01-2»), when it has one. */
  etiqueta?: string | null;
  creada: string;
  /** When it was closed; null or missing while it is open. */
  cerrada?: string | null;
  /** The state Trimble took ("CLOSED", "DONE"), or why it couldn't be closed. */
  cierre?: string;
}

/** A version in Trimble newer than the flow's one: who uploaded it and when, and when it was seen. */
export interface VersionNueva {
  versionId: string | null;
  revision: number | null;
  /** The file's name in that version (Trimble may show another one). */
  nombre: string;
  subido: string | null;
  subidoPor: string;
  subidoPorId: string | null;
  visto: string;
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
  /** The responsible decided on a version they uploaded themself (allowed since 09-11-2026). */
  propia?: boolean;
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
  /** What it is about, for the history and the stored ToDo («Revisar: plano.pdf (Revisa) — hito»). */
  titulo: string;
  /** The detailed text (files and links): only sent if Trimble refuses the flow's own texts. */
  descripcion: string;
  /**
   * What Trimble shows on the ToDo (11-11-2026, the owner's wish): the flow's
   * code on the line above («FLUJO-01»; "" lets Trimble number it), the flow's
   * title and description, and its due date (ISO 8601, or null).
   */
  trimble?: { label: string; title: string; description: string; dueDate: string | null };
  para: { tipo: "persona" | "grupo"; id: string; nombre: string }[];
  /** The registered files it is about. */
  archivos: string[];
  /** What it asks for, to close it later: deciding a step, or correcting a rejected version. */
  tipo?: "revision" | "correccion";
  pasoId?: string | null;
  /** What the extension's own e-mail says (11-11-2026); without it no e-mail goes. */
  correo?: DatosCorreo;
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
  /** Whether the caller is one of them: only they decide (administrators only on a step without responsible). */
  meToca: boolean;
  /** Trimble's viewer at the version under review. */
  enlace: string;
  /** Trimble's viewer at the newer version, when there is one. */
  enlaceNueva: string | null;
  /** The flow's destination folder (older flows only), or null. */
  destino: string | null;
}
