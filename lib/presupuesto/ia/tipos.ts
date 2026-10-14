// The AI assistant of Presupuesto: its quota, its usage log and the drafts it
// proposes (nothing it proposes reaches the budget until a person accepts it).

/** The tasks the assistant does. Phase 1: the work breakdown dictionary. */
export type TareaIA = "edt";
export const TAREA_IA_NOMBRES: Record<TareaIA, string> = { edt: "Diccionario EDT" };

/** Monthly quota of a project, set by the platform's administrators (the "gestor" project). */
export interface CupoIA {
  habilitada: boolean;
  /** Pesos colombianos (estimated API cost) a month for the whole project; 0 = no quota. */
  cupoProyectoCop: number;
  /** Pesos a month for each person. */
  cupoUsuarioCop: number;
}

/** Defaults for projects without their own quota, and the exchange rate. */
export interface CupoGlobalIA extends CupoIA {
  /** COP per USD used to turn the API's cost into pesos (TRM). */
  trm: number;
}

export interface CupoGuardado extends CupoIA {
  trm?: number | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type NivelCupo = "ok" | "aviso" | "agotado" | "deshabilitada";

export interface EstadoCupo extends CupoIA {
  /** Whether the project has its own quota (else the defaults apply). */
  propio: boolean;
  trm: number;
  /** Spent this month (hora de Colombia). */
  gastoProyectoCop: number;
  gastoUsuarioCop: number;
  /** First day of the month counted (YYYY-MM-DD). */
  mes: string;
  nivel: NivelCupo;
  mensaje: string;
}

export type EstadoUsoIA = "ok" | "error" | "rechazado" | "incompleto";

/** One call to the model, as logged. */
export interface RegistroUsoIA {
  id: number;
  projectId: string;
  userId: string;
  userName: string;
  tarea: TareaIA;
  modelo: string;
  /** Partidas sent. */
  items: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCacheEscritura: number;
  tokensCacheLectura: number;
  costoUsd: number;
  trm: number;
  costoCop: number;
  versionPrompt: string;
  estado: EstadoUsoIA;
  detalle: string;
  creado: string;
}

export type EstadoBorrador = "pendiente" | "aceptado" | "rechazado" | "reemplazado";
export type Confianza = "alta" | "media" | "baja";

/** What the assistant proposes for a partida's EDT dictionary. */
export interface PropuestaEdt {
  descripcion: string;
  criterios: string;
  confianza: Confianza;
}

export interface BorradorIA {
  id: string;
  tarea: TareaIA;
  /** The partida (budget row) it is for. */
  itemId: string;
  /** "1.2.3 DESCRIPCIÓN" when it was proposed, to show it even if the row changed. */
  referencia: string;
  propuesta: PropuestaEdt;
  /** What the partida had then. */
  anterior: { descripcion: string; criterios: string } | null;
  estado: EstadoBorrador;
  /** Accepted after changing the text. */
  editado: boolean;
  /** What was applied, when accepted. */
  final: { descripcion: string; criterios: string } | null;
  usoId: number | null;
  creado: string;
  creadoPor: string;
  decidido: string | null;
  decididoPor: string | null;
}

/** How the drafts were judged: the base evaluation of the assistant. */
export interface ResumenBorradores {
  pendientes: number;
  aceptadosSinCambios: number;
  aceptadosEditados: number;
  rechazados: number;
}

export interface EstadoIAResponse {
  /** The server has a key (ANTHROPIC_API_KEY or GEMINI_API_KEY). */
  disponible: boolean;
  /** "Anthropic" or "Google" ("" when none is configured). */
  proveedor: string;
  modelo: string;
  /** Editors of the budget use it. */
  puedeUsar: boolean;
  /** Administrators of the platform's "gestor" project set the quotas. */
  puedeAdministrar: boolean;
  /** Whether the "gestor" project is set (PRESUPUESTO_IA_PROYECTO_GESTOR). */
  gestorConfigurado: boolean;
  cupo: EstadoCupo;
  /** The defaults, for the administrators. */
  global: CupoGlobalIA | null;
  usos: RegistroUsoIA[];
  resumen: ResumenBorradores;
}

/** A partida as it is sent to propose its EDT dictionary. */
export interface PartidaEdtIA {
  id: string;
  /** "1.2.3" */
  item: string;
  descripcion: string;
  unidad: string;
  /** Its titles, outermost first: "ESTRUCTURA > PISO 1". */
  capitulo: string;
  omniclass: string;
  /** What it has now (to improve it), if anything. */
  actual: { descripcion: string; criterios: string } | null;
}

export interface GenerarEdtResponse {
  borradores: BorradorIA[];
  /** Partidas the model left out (they can be asked again). */
  faltantes: string[];
  costoCop: number;
  cupo: EstadoCupo;
}

export const MAX_PARTIDAS_LOTE_IA = 12;
export const MAX_CONTEXTO_IA = 2000;
export const MAX_TEXTO_EDT_IA = 2000;
