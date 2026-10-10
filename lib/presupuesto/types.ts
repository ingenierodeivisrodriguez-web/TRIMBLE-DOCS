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
}

/** Location of an element in the project: block, set, zone, zone name and space. */
export interface Memoria {
  bloque: string;
  conjunto: string;
  zona: string;
  nombreZona: string;
  espacio: string;
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
