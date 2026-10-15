// The AI assistant of Presupuesto: its quota, its usage log and the drafts it
// proposes (nothing it proposes reaches the budget until a person accepts it).

import type { Dependencia, TipoInsumo } from "../types";

/**
 * The tasks the assistant does: the EDT dictionary (phase 1), the resources (phase 2), the EDT
 * itself (phase 3), the unit cost analysis of the partidas (phase 4) and questions about the
 * budget (phase 5).
 */
export type TareaIA = "edt" | "insumos" | "estructura" | "apu" | "chat" | "programa";
export const TAREA_IA_NOMBRES: Record<TareaIA, string> = {
  edt: "Diccionario EDT",
  insumos: "Insumos",
  estructura: "Crear EDT",
  apu: "Análisis (APU)",
  chat: "Preguntas",
  programa: "Secuencia (programación)",
};
/** The tasks whose drafts a person reviews. */
export const TAREAS_CON_BORRADORES: TareaIA[] = ["estructura", "edt", "insumos", "apu", "programa"];

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
  /** The Trimble Connect project's name when the quota was saved. */
  projectName?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** A project with its own quota, as the platform's administrators see it. */
export interface CupoProyectoIA extends CupoIA {
  projectId: string;
  nombre: string;
  /** Spent this month (hora de Colombia). */
  gastoMesCop: number;
  updatedAt: string | null;
  updatedBy: string | null;
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

/** A draft as stored: what it proposes depends on the task. */
export interface BorradorGenerico {
  id: string;
  tarea: TareaIA;
  /** What it is for: a partida, a chapter key or a resource key. */
  itemId: string;
  referencia: string;
  propuesta: unknown;
  anterior: unknown;
  estado: EstadoBorrador;
  editado: boolean;
  final: unknown;
  usoId: number | null;
  creado: string;
  creadoPor: string;
  decidido: string | null;
  decididoPor: string | null;
}

export interface BorradorIA extends BorradorGenerico {
  tarea: "edt";
  propuesta: PropuestaEdt;
  /** What the partida had then. */
  anterior: { descripcion: string; criterios: string } | null;
  estado: EstadoBorrador;
  /** Accepted after changing the text. */
  editado: boolean;
  /** What was applied, when accepted. */
  final: { descripcion: string; criterios: string } | null;
}

// ---- phase 3: the EDT (chapters and partidas) from the project's description

export type AgrupacionEdt = "capitulos" | "pisos";
export type DetalleEdt = "resumido" | "detallado";

export interface CapituloIA {
  /** In capitals, like the catalog. */
  titulo: string;
  /** One sentence: what the chapter covers. */
  alcance: string;
  /** Its partidas repeat on every typical floor (grouping by floors). */
  porPiso: boolean;
}

export interface PartidaPropuestaIA {
  /** A catalog partida that fits (it brings its unit cost analysis), or null for a new one. */
  catalogoId: string | null;
  descripcion: string;
  unidad: string;
}

export interface PropuestaCapitulo extends CapituloIA {
  partidas: PartidaPropuestaIA[];
}

export interface BorradorEstructuraIA extends BorradorGenerico {
  tarea: "estructura";
  propuesta: PropuestaCapitulo;
  anterior: null;
  final: PropuestaCapitulo | null;
}

/** What the person wants built. */
export interface PeticionEstructura {
  descripcion: string;
  agrupacion: AgrupacionEdt;
  detalle: DetalleEdt;
}

/** A catalog partida offered to the model. */
export interface PartidaCatalogoIA {
  id: string;
  descripcion: string;
  unidad: string;
}

// ---- phase 2: the resources the partidas need

/** A catalog resource offered to the model. */
export interface InsumoCatalogoIA {
  id: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
}

/** A resource the catalog lacks, proposed to create (without a price: the person sets it). */
export interface PropuestaInsumo {
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  /** The partidas that need it ("1.2 DESCRIPCIÓN"). */
  usadoEn: string[];
}

export interface BorradorInsumoIA extends BorradorGenerico {
  tarea: "insumos";
  propuesta: PropuestaInsumo;
  anterior: null;
  final: PropuestaInsumo | null;
}

/** A partida whose resources are asked for. */
export interface PartidaInsumosIA {
  id: string;
  item: string;
  descripcion: string;
  unidad: string;
  capitulo: string;
}

export interface GenerarInsumosResponse {
  borradores: BorradorInsumoIA[];
  /** Resources the catalog already has that these partidas use. */
  delCatalogo: { id: string; descripcion: string; partidas: string[] }[];
  costoCop: number;
  cupo: EstadoCupo;
}

// ---- phase 4: the unit cost analysis (APU) of the partidas

/**
 * A line of a proposed analysis: a catalog resource, or a new one (insumoId null) to create
 * without a price. Labor and equipment paid by the hour take a crew (cuadrilla), and their
 * quantity is cuadrilla × jornada ÷ rendimiento; the rest take a quantity per unit (with waste).
 */
export interface LineaApuIA {
  insumoId: string | null;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  cuadrilla: number | null;
  /** Per unit of the partida (0 when the crew sets it); for "%MO" resources, a percentage of the labor. */
  cantidad: number;
}

export interface PropuestaApu {
  /** Units of the partida a crew does in a working day. */
  rendimiento: number;
  lineas: LineaApuIA[];
  /** What it assumed (mix, thickness, waste...), for the person to check. */
  supuestos: string;
  confianza: Confianza;
}

export interface BorradorApuIA extends BorradorGenerico {
  tarea: "apu";
  propuesta: PropuestaApu;
  anterior: null;
  final: PropuestaApu | null;
}

/** A catalog partida with its analysis, shown to the model as an example (no prices). */
export interface ReferenciaApuIA {
  descripcion: string;
  unidad: string;
  rendimiento: number;
  lineas: { insumoId: string; cuadrilla: number | null; cantidad: number }[];
  /** Subpartidas it uses, as text ("CONCRETO 3000 PSI (M3) × 1.05"). */
  subpartidas: string[];
}

/** A partida whose analysis is asked for. */
export interface PartidaApuIA {
  id: string;
  item: string;
  descripcion: string;
  unidad: string;
  capitulo: string;
  /** Hours of its working day. */
  jornada: number;
  /** Similar catalog partidas with their analysis. */
  referencias: ReferenciaApuIA[];
}

export interface GenerarApuResponse {
  /** The proposals saved as drafts (none when evaluating). */
  borradores: BorradorApuIA[];
  /** Every proposal, by partida (also when evaluating, where nothing is saved). */
  propuestas: { itemId: string; propuesta: PropuestaApu }[];
  /** Partidas left without a usable answer. */
  faltantes: string[];
  costoCop: number;
  cupo: EstadoCupo;
}

// ---- the schedule: work packages and constructive sequence of the activities

/** An activity as it is sent. */
export interface ActividadProgramaIA {
  id: string;
  nombre: string;
  unidad: string;
  cantidad: number | null;
  /** Working days. */
  duracion: number;
  /** Its work package now ("ESTRUCTURA > PISO 1"). */
  ruta: string;
}

/** What the assistant proposes for an activity: its work package (path inside the scope) and its predecessors. */
export interface PropuestaActividadIA {
  id: string;
  paquete: string[];
  predecesoras: Dependencia[];
}

export interface PropuestaPrograma {
  /** The EDT node the paths hang from (null: the top). */
  alcance: string | null;
  actividades: PropuestaActividadIA[];
}

export interface BorradorProgramaIA extends BorradorGenerico {
  tarea: "programa";
  propuesta: PropuestaPrograma;
  anterior: null;
  final: PropuestaPrograma | null;
}

export const MAX_ACTIVIDADES_PROGRAMA_IA = 150;

// ---- phase 5: questions about the budget

export interface MensajeChatIA {
  rol: "usuario" | "asistente";
  texto: string;
}

export interface RespuestaChatIA {
  respuesta: string;
  /** Codes ("P12") of the partidas the answer is about, as the context named them. */
  items: string[];
  costoCop: number;
  cupo: EstadoCupo;
}

/** How the drafts were judged: the base evaluation of the assistant. */
export interface ResumenBorradores {
  pendientes: number;
  aceptadosSinCambios: number;
  aceptadosEditados: number;
  rechazados: number;
}

/** The evaluation of each task (tasks without drafts are left out). */
export type ResumenesIA = Partial<Record<TareaIA, ResumenBorradores>>;

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
  /** Every project with its own quota, for the administrators. */
  proyectos: CupoProyectoIA[] | null;
  usos: RegistroUsoIA[];
  resumen: ResumenesIA;
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
/** Partidas per call for their analysis (a longer answer each). */
export const MAX_PARTIDAS_LOTE_APU = 6;
export const MAX_LINEAS_APU = 40;
export const MAX_REFERENCIAS_APU = 3;
/** The budget sent with a question (characters). */
export const MAX_CONTEXTO_CHAT = 150_000;
export const MAX_PREGUNTA_CHAT = 1500;
export const MAX_HISTORIAL_CHAT = 12;
/** Calls a person can make in a minute (protects the quota from a runaway loop). */
export const MAX_LLAMADAS_MINUTO_IA = 20;
/** Catalog entries offered to the model in one call. */
export const MAX_CATALOGO_IA = 1500;
export const MAX_CONTEXTO_IA = 2000;
export const MAX_TEXTO_EDT_IA = 2000;
