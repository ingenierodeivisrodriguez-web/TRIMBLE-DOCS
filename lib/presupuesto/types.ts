// Shared by the API, the budget screen (project menu) and the 3D viewer panel.
import type { Responsable } from "../propiedades/types";

// ---------------------------------------------------------------- resources (insumos)

/** Kinds of resource: labor, materials, equipment and tools, subcontracts. */
export type TipoInsumo = "MO" | "MT" | "EQ" | "SC";
export const TIPOS_INSUMO: TipoInsumo[] = ["MO", "MT", "EQ", "SC"];
export const TIPO_LABELS: Record<TipoInsumo, string> = {
  MO: "Mano de obra",
  MT: "Materiales",
  EQ: "Equipos y herramientas",
  SC: "Subcontratos",
};

/** The columns a unit cost splits into: the four kinds of resources plus subpartidas. */
export type Rubro = TipoInsumo | "SP";
export const RUBROS: Rubro[] = ["MO", "MT", "EQ", "SC", "SP"];
export const RUBRO_NOMBRES: Record<Rubro, string> = {
  MO: "Mano de Obra",
  MT: "Materiales",
  EQ: "Equipos",
  SC: "Subcontratos",
  SP: "Subpartidas",
};
export const RUBRO_COLORS: Record<Rubro, string> = {
  MO: "#e8833a",
  MT: "#4a77e8",
  EQ: "#5aa55a",
  SC: "#7d2a8c",
  SP: "#1f2f7a",
};

export interface InsumoData {
  codigo: string;
  descripcion: string;
  unidad: string;
  precio: number;
  tipo: TipoInsumo;
  /** Índice unificado (price index the resource follows), free text. */
  iu: string;
  /** OmniClass code, e.g. "23-13 35 11". */
  omniclass: string;
}

export interface Insumo extends InsumoData {
  id: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------- unit cost analysis (APU)

/**
 * A line of a unit cost analysis: a resource or a subpartida. For labor and
 * equipment, `cuadrilla` (crew size) sets the quantity: cuadrilla × jornada ÷
 * rendimiento; without it the quantity is typed directly.
 */
export interface Componente {
  tipo: "insumo" | "subpartida";
  id: string;
  cuadrilla: number | null;
  cantidad: number;
}

export interface Apu {
  /** Units of the partida produced per day. */
  rendimiento: number;
  /** Hours per working day. */
  jornada: number;
  componentes: Componente[];
}

export interface PartidaData extends Apu {
  codigo: string;
  descripcion: string;
  unidad: string;
  /** OmniClass Table 22 (Work Results) code, e.g. "22-03 30 00". */
  omniclass: string;
  /** Work breakdown dictionary data. */
  edt?: Edt;
}

/** A partida of the catalog (base de datos de partidas). */
export interface PartidaCatalogo extends PartidaData {
  id: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface OmniclassEntry {
  codigo: string;
  titulo: string;
}

// ---------------------------------------------------------------- the budget

/** A resource as priced in this budget (copied from the catalog when first used). */
export type InsumoPresupuesto = InsumoData;

/** A subpartida of the budget: an APU used inside other partidas. */
export interface Subpartida extends PartidaData {
  /** The catalog partida it was copied from, if any. */
  origenId: string | null;
}

export interface ItemTitulo {
  id: string;
  tipo: "titulo";
  /** Depth in the outline: 0 for top-level rows. */
  nivel: number;
  descripcion: string;
}

export interface ItemPartida extends PartidaData {
  id: string;
  tipo: "partida";
  nivel: number;
  /** Typed quantity; replaced by the model's when the partida measures its elements. */
  metrado: number;
  origenId: string | null;
  /**
   * Where the quantity comes from: typed ("manual") or from the linked model
   * elements ("3d"). Not set: from the model when the partida measures them.
   */
  modo?: ModoMetrado;
}

/** The quantity the model's elements give a partida. */
export interface MetradoModeloInfo {
  valor: number;
  elementos: number;
  campoLabel: string;
}

export type ModoMetrado = "manual" | "3d";

/** EDT dictionary of a partida: what the work is, how it is accepted, and who answers for it. */
export interface Edt {
  descripcion: string;
  criterios: string;
  responsable: string;
}

export type Item = ItemTitulo | ItemPartida;

/** A row of the budget footer: variable = formula of CD and the rows above. */
export interface FilaPie {
  variable: string;
  descripcion: string;
  formula: string;
  iu: string;
  resaltar: boolean;
}

export interface Subpresupuesto {
  id: string;
  nombre: string;
  /** The outline in order; titles contain the rows below them with a deeper `nivel`. */
  items: Item[];
  pie: FilaPie[];
}

export type FormatoGasto = "general" | "personal";
export const FORMATO_LABELS: Record<FormatoGasto, string> = {
  general: "General (cantidad × precio)",
  personal: "Personal (cantidad × % participación × tiempo × precio)",
};

export interface ItemGasto {
  id: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precio: number;
  /** % of participation (personal format). */
  participacion: number;
  /** Time, e.g. months (personal format). */
  tiempo: number;
}

export interface TituloGasto {
  id: string;
  descripcion: string;
  formato: FormatoGasto;
  items: ItemGasto[];
}

export interface GastosGenerales {
  fijos: TituloGasto[];
  variables: TituloGasto[];
}

export interface PresupuestoDoc {
  subpresupuestos: Subpresupuesto[];
  /** Prices of this budget, by catalog resource id. */
  insumos: Record<string, InsumoPresupuesto>;
  subpartidas: Record<string, Subpartida>;
  gastos: GastosGenerales;
}

export interface DocumentoResponse {
  doc: PresupuestoDoc;
  /** 0 until the budget is first saved; saving sends it back to detect concurrent edits. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------- configuration and permissions

export interface PresupuestoConfig {
  /** The project whose catalogs (insumos and partidas) this one uses: itself, or a shared "base" project. */
  baseProjectId: string;
  baseProjectName: string;
  /** Who can edit besides the project administrators. */
  editores: Responsable[];
  /** Columns of the memoria de cantidades. */
  memoriaColumnas: ColumnaMemoria[];
}

export interface EstadoResponse {
  projectId: string;
  config: PresupuestoConfig;
  /** True when the project uses its own catalogs. */
  esBasePropia: boolean;
  isAdmin: boolean;
  /** Can edit the budget and link elements in the viewer. */
  canEdit: boolean;
  /** Can edit the catalogs (administrators and editors of the base project). */
  canEditBase: boolean;
  /** Why the catalogs are read-only, when they are. */
  baseNote: string;
  user: { id: string; name: string };
}

// ---------------------------------------------------------------- model elements

/** "Measure by": count the elements instead of adding up a property. */
export const CONTEO = "@count";

export interface ElementoVinculado {
  itemId: string;
  ifcGuid: string;
  modelId: string;
  /** The element's quantity for the partida's measure (null: not measured). */
  cantidad: number | null;
  /** Where the element is, read from its model properties when it was linked. */
  memoria: Memoria | null;
  /** The day it was built for this partida (YYYY-MM-DD), marked in the viewer; null: not yet. */
  ejecutado?: string | null;
}

/** Data of a linked element for the columns of the memoria de cantidades, by column id. */
export type Memoria = Record<string, string>;

/** A column the user chose for the memoria de cantidades. */
export interface ColumnaMemoria {
  /** Stable id (the key of the value in `Memoria`). */
  id: string;
  label: string;
  /**
   * Where the value comes from: a property of the model (read when the element
   * is linked), an attribute of the Propiedades app (read live, by IFCGUID), or
   * the element's own IFCGUID.
   */
  fuente: "modelo" | "propiedad" | "ifcguid";
  /** Property name (or "Set · Property") for "modelo", attribute id for "propiedad". */
  clave: string;
}

export const MAX_COLUMNAS_MEMORIA = 6;

/** The columns the memoria de cantidades starts with. */
export const DEFAULT_COLUMNAS_MEMORIA: ColumnaMemoria[] = [
  { id: "bloque", label: "Bloque", fuente: "modelo", clave: "Bloque" },
  { id: "conjunto", label: "Conjunto", fuente: "modelo", clave: "Conjunto" },
  { id: "zona", label: "Zona", fuente: "modelo", clave: "Zona" },
  { id: "nombreZona", label: "Nombre de zona", fuente: "modelo", clave: "Nombre de zona" },
  { id: "espacio", label: "Espacio", fuente: "modelo", clave: "Espacio" },
];

/** An element to show in the 3D viewer. */
export interface ElementoRef {
  ifcGuid: string;
  modelId: string;
}

/** Elements somebody asked to see in 3D, waiting for the viewer panel to pick them up. */
export interface VistaPendiente {
  /** "ver": select `elementos` in 3D. "memoria": update the memoria de cantidades of every partida. */
  tarea: "ver" | "memoria";
  itemId: string;
  elementos: ElementoRef[];
}

/** A model that has elements linked to partidas. */
export interface ModeloUsado {
  modelId: string;
  elementos: number;
}

export const MAX_ELEMENTOS_VISTA = 2000;
export const VISTA_MINUTOS = 30;

/** A property found in the models loaded in the viewer. */
export interface CampoModelo {
  /** "Set · Property" (or "@name"...), what a column of the memoria uses to find it. */
  key: string;
  label: string;
  group: string;
  kind: "number" | "text" | "date";
  /** Elements that carry it, among those read. */
  count: number;
}

/** The properties of the models, as last read in the viewer. */
export interface CamposModelo {
  leido: string;
  leidoPor: string | null;
  modelos: string[];
  campos: CampoModelo[];
}

export const MAX_CAMPOS_MODELO = 2000;

/** An attribute of the Propiedades app that can be a column. */
export interface AtributoPropiedad {
  id: string;
  title: string;
  dataType: string;
}

/** How a partida takes its quantity from its elements: a property, a count, or not at all (campo null). */
export interface Medicion {
  itemId: string;
  campo: string | null;
  campoLabel: string;
  unidad: string;
}

export interface ResumenItem {
  itemId: string;
  elementos: number;
  suma: number;
}

export interface ResumenElementos {
  mediciones: Medicion[];
  resumen: ResumenItem[];
}

export interface CatalogoResponse {
  baseProjectId: string;
  insumos: Insumo[];
  partidas: PartidaCatalogo[];
  omniclass: OmniclassEntry[];
}

// ---------------------------------------------------------------- limits

export const MAX_TEXT = 300;
export const MAX_SHORT_TEXT = 40;
export const MAX_COMPONENTES = 200;
export const MAX_SUBPRESUPUESTOS = 50;
export const MAX_ITEMS = 10_000;
export const MAX_PIE = 30;
export const MAX_NIVEL = 9;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_ELEMENTS_PER_REQUEST = 500;
export const MAX_EDITORES = 50;

// ---------------------------------------------------------------- schedule (programación / Gantt)

/** How a task depends on another: Fin-Comienzo, Comienzo-Comienzo, Fin-Fin, Comienzo-Fin. */
export type TipoDependencia = "FC" | "CC" | "FF" | "CF";
export const TIPOS_DEPENDENCIA: TipoDependencia[] = ["FC", "CC", "FF", "CF"];
export const TIPO_DEPENDENCIA_NOMBRES: Record<TipoDependencia, string> = {
  FC: "Fin a comienzo (FC)",
  CC: "Comienzo a comienzo (CC)",
  FF: "Fin a fin (FF)",
  CF: "Comienzo a fin (CF)",
};

export interface Dependencia {
  /** The predecessor partida's id. */
  id: string;
  tipo: TipoDependencia;
  /** Working days after the predecessor's date; negative to start in advance (adelanto). */
  desfase: number;
}

/** What the user set for a partida in the schedule (the rest comes from the budget). */
export interface TareaProgramada {
  /** Working days. Not set: estimated from metrado ÷ (rendimiento × cuadrillas). */
  duracion?: number;
  /** Crews working at once (for the estimate). Default 1. */
  cuadrillas?: number;
  predecesoras?: Dependencia[];
  /** "Don't start before" this date (YYYY-MM-DD). */
  inicio?: string;
}

export interface DiaEspecial {
  /** YYYY-MM-DD */
  fecha: string;
  /** Hours worked that day: 0 for a holiday. */
  horas: number;
  nombre: string;
}

export interface CalendarioLaboral {
  /** Hours worked each day of the week, Monday first. */
  horasSemana: number[];
  /** Hours of a working day: one day of duration is this many hours. */
  jornada: number;
  /** Holidays and days with other hours. */
  especiales: DiaEspecial[];
}

/** How estimated durations are rounded up. */
export type RedondeoDuracion = "dia" | "medio" | "no";

export interface Programacion {
  /** Project start (YYYY-MM-DD). */
  inicio: string;
  /** Date the project should end by (YYYY-MM-DD), to compare. */
  finObjetivo: string | null;
  calendario: CalendarioLaboral;
  redondeo: RedondeoDuracion;
  /** By partida id. */
  tareas: Record<string, TareaProgramada>;
}

export interface ProgramacionResponse {
  /** null until the schedule is first saved. */
  programacion: Programacion | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const MAX_DIAS_ESPECIALES = 1000;
export const MAX_PREDECESORAS = 50;
export const MAX_DURACION_DIAS = 10_000;

// ---------------------------------------------------------------- baseline and progress (valor ganado)

/** A row of a baseline: what was planned for a partida, or for the title or subpresupuesto that holds partidas. */
export interface TareaBase {
  /** The item's id; "sp:<id>" for a subpresupuesto. */
  id: string;
  tipo: "sp" | "titulo" | "partida";
  spId: string;
  nivel: number;
  numero: string;
  descripcion: string;
  unidad: string;
  /** The rows that contain it, outermost first. */
  ancestros: string[];
  metrado: number | null;
  /** Planned cost (its amount in the budget when the baseline was saved). */
  costo: number;
  /** Working hours from the baseline calendar's start. */
  es: number;
  ef: number;
  /** YYYY-MM-DD */
  inicio: string;
  fin: string;
  /** Working days. */
  duracion: number;
}

/** The approved schedule, frozen: dates, durations and planned costs. */
export interface LineaBaseDatos {
  /** The date the calendar counts hours from (the schedule's start setting). */
  calendarioInicio: string;
  calendario: CalendarioLaboral;
  inicio: string;
  fin: string;
  /** Planned cost of the whole budget (BAC). */
  total: number;
  /** In the order of the schedule. */
  tareas: TareaBase[];
}

export interface LineaBaseResumen {
  id: string;
  nombre: string;
  /** Progress is measured against it. */
  vigente: boolean;
  creada: string;
  creadaPor: string | null;
  inicio: string;
  fin: string;
  total: number;
  partidas: number;
}

export interface LineaBase extends LineaBaseResumen {
  datos: LineaBaseDatos;
}

/** What a partida had done at a cut date. */
export interface AvancePartida {
  /** Cumulative % done, 0 to 100. */
  pct: number;
  /** Actual cost to date (cumulative), when it is recorded. */
  costo?: number;
}

/** A progress report: each partida's cumulative progress at a date. */
export interface CorteAvance {
  id: string;
  /** YYYY-MM-DD */
  fecha: string;
  nota: string;
  /** By partida id; a partida that isn't listed is at 0 %. */
  partidas: Record<string, AvancePartida>;
}

export interface ControlAvance {
  /** By date. */
  cortes: CorteAvance[];
}

export interface AvanceResponse {
  /** null until the progress is first saved. */
  avance: ControlAvance | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  lineasBase: LineaBaseResumen[];
  /** The baseline in force, with its rows. */
  lineaBase: LineaBase | null;
}

/** How many of a partida's elements were built by a date, and their quantities. */
export interface EjecucionItem {
  itemId: string;
  elementos: number;
  ejecutados: number;
  suma: number;
  sumaEjecutada: number;
}

/** An element's mark for a partida (built that day, or not: null). */
export interface MarcaEjecucion {
  itemId: string;
  ifcGuid: string;
}

export const MAX_CORTES = 400;
export const MAX_LINEAS_BASE = 50;
