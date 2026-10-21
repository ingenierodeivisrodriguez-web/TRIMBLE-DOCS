// "Requisitos BIM (LOIN)": what is modeled, with which geometric detail and
// which information, by discipline and stage (ISO 7817-1 level of information
// need), and later the audit of the 3D models against it. Phase 1: the
// parameter catalog (data dictionary), disciplines, elements to model with
// their reference images and required parameters, and discipline templates.
import type { Responsable } from "../propiedades/types";

/** Nivel de información (NDI): cumulative, an element required at NDI-2 needs its NDI-1 and NDI-2 parameters. */
export type Ndi = 1 | 2 | 3;
export const NDIS: Ndi[] = [1, 2, 3];

/** Where the value comes from: the geometry/software, the modeler, or not decided yet. */
export type OrigenDato = "automatica" | "a_ingresar" | "por_definir";
export const ORIGENES: Record<OrigenDato, string> = { automatica: "Automática", a_ingresar: "A ingresar", por_definir: "Por definir" };

export type TipoDato = "texto" | "numero" | "booleano" | "fecha" | "lista";
export const TIPOS_DATO: Record<TipoDato, string> = {
  texto: "Texto",
  numero: "Número",
  booleano: "Sí / No",
  fecha: "Fecha",
  lista: "Lista de valores",
};

/** Optional checks on a value besides "not empty". A "lista" only takes its allowed values. */
export interface ReglaValor {
  /** Numbers: inclusive bounds, in the unit the model gives (null: no bound). */
  min: number | null;
  max: number | null;
  /** Text: a regular expression the whole value must match ("" = none). */
  patron: string;
}
export const REGLA_VACIA: ReglaValor = { min: null, max: null, patron: "" };

/**
 * Where to look for a parameter in the model, in order of preference.
 * `grupo` is the property set or Revit group ("*" or "Qto_*" style wildcards
 * allowed); "@" means an IFC attribute of the object (Name, Description…).
 * Suggested ones (`sugerida`) were proposed by the app and wait for a person
 * to confirm them.
 */
export interface Alias {
  grupo: string;
  propiedad: string;
  sugerida: boolean;
}

/** A TDI group (tipo de información): its letter and its editable name. */
export interface GrupoTdi {
  codigo: string;
  nombre: string;
}

export interface ParametroData {
  /** Internal code, unique in the catalog (e.g. "DYCO-018"). */
  codigo: string;
  /** N° of the DYCO list. */
  numero: number | null;
  nombre: string;
  descripcion: string;
  /** Letter of the TDI group ("A", "B"…). */
  tdi: string;
  ndi: Ndi;
  origen: OrigenDato;
  tipoDato: TipoDato;
  unidad: string;
  valoresPermitidos: string[];
  regla: ReglaValor;
  alias: Alias[];
  /** IDS / bSDD URI, optional. */
  idsUri: string;
  activo: boolean;
}

export interface Parametro extends ParametroData {
  id: string;
  version: number;
  actualizado: string;
  actualizadoPor: string | null;
}

export interface DisciplinaData {
  codigo: string;
  nombre: string;
  /** "#RRGGBB" */
  color: string;
  orden: number;
  activo: boolean;
}

export interface Disciplina extends DisciplinaData {
  id: string;
  version: number;
  actualizado: string;
  actualizadoPor: string | null;
}

/** A catalog parameter required for an element; `ndi` / `regla` null take the catalog's. */
export interface ParametroExigido {
  parametroId: string;
  obligatorio: boolean;
  ndi: Ndi | null;
  regla: ReglaValor | null;
}

export interface ElementoData {
  disciplinaId: string;
  codigo: string;
  nombre: string;
  /** "IfcWall" ("" = not set). */
  claseIfc: string;
  /** "SOLIDWALL", "FLOOR"… ("" = any). */
  tipoPredefinido: string;
  /** "OmniClass", "Uniclass" ("" = none). */
  clasificacionSistema: string;
  clasificacionCodigo: string;
  /** How it must be modeled (layers, by level, joins, what is not modeled). */
  notas: string;
  parametros: ParametroExigido[];
  /** Which objects of the models are this element (null: no rule yet). */
  regla: ReglaAsociacion | null;
  orden: number;
  activo: boolean;
}

// ---------------------------------------------------------------- linking the models (phase 3)

/**
 * What a condition looks at: "@clase" (IFC class), "@nombre" (object name),
 * "@tipo" (type name), "@descripcion", "@nivel" (the level, from the usual
 * level properties) or a property written like an alias: "Grupo.Propiedad",
 * "*.Propiedad", "Pset_*Common.Propiedad".
 */
export type OperadorRegla = "igual" | "distinto" | "contiene" | "no_contiene" | "empieza" | "existe" | "no_existe";

export interface CondicionRegla {
  campo: string;
  operador: OperadorRegla;
  valor: string;
}

/** "todas" = every condition (Y); "alguna" = any of them (O). Without conditions it matches nothing. */
export interface ReglaAsociacion {
  modo: "todas" | "alguna";
  condiciones: CondicionRegla[];
}

/** A model file (stable across versions) and the disciplines it belongs to. */
export interface ModeloDisciplina {
  fileId: string;
  nombre: string;
  disciplinaIds: string[];
  actualizado: string;
  actualizadoPor: string | null;
}

/** An object linked by hand to an element (wins over the rules). */
export interface AsociacionManual {
  ifcGuid: string;
  fileId: string;
  elementoId: string;
  creado: string;
  creadoPor: string | null;
}

/** Property names found in the loaded models (to pick aliases and rule fields from the project's menu). */
export interface CamposModelo {
  leido: string;
  leidoPor: string | null;
  modelos: string[];
  campos: { grupo: string; propiedad: string; cuenta: number }[];
}

export interface VisorResponse {
  modelos: ModeloDisciplina[];
  asociaciones: AsociacionManual[];
}

export const MAX_CONDICIONES = 12;
export const MAX_ASOCIACIONES_POR_ENVIO = 2000;
export const MAX_CAMPOS_MODELO = 3000;

export interface Imagen {
  id: string;
  elementoId: string;
  nombre: string;
  /** "image/webp", "image/jpeg" or "image/png". */
  tipo: string;
  ancho: number;
  alto: number;
  bytes: number;
  /** Signed URL, valid for a while (empty when it couldn't be signed). */
  url: string;
  subida: string;
  subidaPor: string | null;
}

export interface Elemento extends ElementoData {
  id: string;
  version: number;
  actualizado: string;
  actualizadoPor: string | null;
}

/** A discipline copied whole, kept in the base project so other projects using the same catalog can use it. */
export interface ContenidoPlantilla {
  disciplina: { codigo: string; nombre: string; color: string };
  elementos: (Omit<ElementoData, "disciplinaId" | "activo"> & { imagenes: ImagenPlantilla[] })[];
}

export interface ImagenPlantilla {
  /** Where the copy kept for the template is stored. */
  ruta: string;
  nombre: string;
  tipo: string;
  ancho: number;
  alto: number;
  bytes: number;
}

export interface PlantillaData {
  nombre: string;
  descripcion: string;
  contenido: ContenidoPlantilla;
  activo: boolean;
}

export interface Plantilla extends PlantillaData {
  id: string;
  version: number;
  creada: string;
  creadaPor: string | null;
  actualizado: string;
}

/** A project's settings; the TDI names belong to the catalog (its base project). */
export interface ConfigLoin {
  baseProjectId: string;
  baseProjectName: string;
  editores: Responsable[];
  /** Values that count as empty in text parameters ("N/A", "-"…). */
  valoresBasura: string[];
  /** Below 100 % of the required parameters and at least this %: yellow; below it: red. */
  umbralAmarillo: number;
}

export interface EstadoResponse {
  projectId: string;
  config: ConfigLoin;
  tdiGrupos: GrupoTdi[];
  /** True when the project uses its own catalog. */
  esBasePropia: boolean;
  isAdmin: boolean;
  /** Edits disciplines, elements and (later) the matrix, rules and audits. */
  canEdit: boolean;
  /** Edits the parameter catalog, the TDI names and the templates (in the base project). */
  canEditBase: boolean;
  baseNote: string;
  /** Whether images can be stored (Supabase Storage configured). */
  imagenesDisponibles: boolean;
  user: { id: string; name: string };
}

export interface CatalogoResponse {
  baseProjectId: string;
  parametros: Parametro[];
  tdiGrupos: GrupoTdi[];
}

export interface ElementosResponse {
  disciplinas: Disciplina[];
  elementos: Elemento[];
  imagenes: Imagen[];
}

// ---------------------------------------------------------------- stages and the LOIN matrix

/** Geometric level of development (BIMForum convention). */
export const LODS = [100, 200, 300, 350, 400, 500] as const;
export type Lod = (typeof LODS)[number];

export interface EtapaData {
  codigo: string;
  nombre: string;
  /** Milestone date, "AAAA-MM-DD" (shown DD-MM-AAAA); null when not set. */
  fecha: string | null;
  orden: number;
  activo: boolean;
}

export interface Etapa extends EtapaData {
  id: string;
  version: number;
  actualizado: string;
  actualizadoPor: string | null;
}

/** What one element must have at one stage. Both levels null = not required at that stage. */
export interface Requerimiento {
  lod: Lod | null;
  ndi: Ndi | null;
  /** Coordinación, Cantidades, Licencia… */
  propositos: string[];
  /** Who delivers it (the discipline's designer). */
  actor: string;
  nota: string;
}

export interface CeldaData extends Requerimiento {
  elementoId: string;
  etapaId: string;
}

export interface CeldaMatriz extends CeldaData {
  id: string;
  version: number;
  actualizado: string;
  actualizadoPor: string | null;
}

export interface MatrizResponse {
  etapas: Etapa[];
  celdas: CeldaMatriz[];
}

export const MAX_CELDAS_POR_ENVIO = 500;
export const MAX_PROPOSITOS = 12;

export const MAX_EDITORES = 50;
export const MAX_PARAMETROS_POR_ENVIO = 200;
export const MAX_PARAMETROS_CATALOGO = 3000;
export const MAX_PARAMETROS_ELEMENTO = 400;
export const MAX_VALORES_PERMITIDOS = 100;
export const MAX_ALIAS = 12;
export const MAX_IMAGENES_ELEMENTO = 6;
/** After reducing it in the browser (WebP up to 1600 px is usually far smaller). */
export const MAX_BYTES_IMAGEN = 2_000_000;
export const MAX_LADO_IMAGEN = 1600;
export const MAX_VALORES_BASURA = 60;
export const MAX_TEXTO = 4000;
export const MAX_CORTO = 200;
export const MAX_ELEMENTOS_PLANTILLA = 300;
