// Which element to model each object of the 3D models is: by hand (its
// IFCGUID linked to an element, which always wins) or by the elements' rules
// (conditions on the IFC class, name, type, level or any property, combined
// with Y / O). Objects of a model are only matched against the elements of
// the disciplines that model belongs to; what matches nothing is "sin
// clasificar" (an audit finding too). Pure: it runs on objects already read.
import type { RawObject } from "../graficos/modelData";
import { resolveIfcGuid } from "../propiedades/ifcGuid";
import { buscarValor, estaVacio, leerAlias, normalizarNombre, PropiedadesObjeto } from "./alias";
import type { CondicionRegla, Disciplina, Elemento, OperadorRegla, ReglaAsociacion } from "./types";

/** One object as read from the viewer, with what the rules look at. */
export interface ObjetoModelo {
  runtimeId: number;
  /** 22-character IFCGUID, or null (it can't be linked by hand nor audited). */
  ifcGuid: string | null;
  clase: string;
  nombre: string;
  tipo: string;
  descripcion: string;
  props: PropiedadesObjeto;
}

/** The objects of one loaded model. */
export interface ModeloLeido {
  /** The file id (stable across versions), as stored with the disciplines and the manual links. */
  fileId: string;
  nombre: string;
  /** The id the viewer answers with (for selections and colors). */
  viewerModelId: string;
  objetos: ObjetoModelo[];
}

/**
 * An object as the viewer describes it (getObjectProperties), with its
 * IFCGUID: an explicit GUID property wins (Revit's IfcGUID), otherwise the
 * viewer's external id when it is a GUID (IFC models).
 */
export function objetoDesdeRaw(raw: RawObject, externalId: string | null): ObjetoModelo {
  const grupos = (raw.properties ?? []).map((set) => ({
    nombre: set.name ?? "Propiedades",
    propiedades: (set.properties ?? []).filter((p) => p && p.name != null).map((p) => ({ nombre: String(p.name), valor: p.value })),
  }));
  const nombre = raw.product?.name?.trim() ?? "";
  const tipo = raw.product?.objectType?.trim() ?? "";
  const descripcion = raw.product?.description?.trim() ?? "";
  return {
    runtimeId: raw.id,
    ifcGuid: resolveIfcGuid(externalId, raw.properties ?? []).guid,
    clase: raw.class?.trim() ?? "",
    nombre,
    tipo,
    descripcion,
    props: { grupos, atributos: { Name: nombre, ObjectType: tipo, Description: descripcion, Class: raw.class ?? "" } },
  };
}

export const CAMPOS_FIJOS: { campo: string; nombre: string }[] = [
  { campo: "@clase", nombre: "Clase IFC" },
  { campo: "@nombre", nombre: "Nombre" },
  { campo: "@tipo", nombre: "Tipo" },
  { campo: "@descripcion", nombre: "Descripción" },
  { campo: "@nivel", nombre: "Nivel" },
];

export const OPERADORES: Record<OperadorRegla, string> = {
  igual: "es",
  distinto: "no es",
  contiene: "contiene",
  no_contiene: "no contiene",
  empieza: "empieza por",
  existe: "tiene valor",
  no_existe: "no tiene valor",
};

/** Where models usually keep the level (Revit in Spanish and English, IFC exports). */
const ALIAS_NIVEL = [
  "*.Nivel",
  "*.Nivel de referencia",
  "*.Restricción de base",
  "*.Nivel base",
  "*.Level",
  "*.Reference Level",
  "*.Base Constraint",
  "*.Base Level",
  "*.Building Storey",
  "*.Storey",
  "*.Piso",
].map((t) => leerAlias(t)!);

/**
 * Containers and helpers of the model tree that are not elements to model:
 * they are neither classified nor listed as "sin clasificar" (unless a rule
 * or a manual link asks for them, as the project object does).
 */
export const CLASES_IGNORADAS = new Set(
  ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcOpeningElement", "IfcGrid", "IfcAnnotation", "IfcVirtualElement", "IfcGroup", "IfcSystem", "IfcDistributionPort", "IfcPort"].map((c) =>
    c.toLowerCase()
  )
);

/** "IFCWALLSTANDARDCASE", "IfcWallStandardCase" -> "ifcwall" (a subtype written out counts as its class). */
export function claseBase(clase: string): string {
  return clase.trim().toLowerCase().replace(/(standardcase|elementedcase)$/, "");
}

export function nombreCampo(campo: string): string {
  return CAMPOS_FIJOS.find((c) => c.campo === campo)?.nombre ?? campo;
}

/** The value a condition looks at, as text ("" when the object doesn't have it). */
export function valorCampo(o: ObjetoModelo, campo: string): string {
  switch (campo) {
    case "@clase":
      return o.clase;
    case "@nombre":
      return o.nombre;
    case "@tipo":
      return o.tipo;
    case "@descripcion":
      return o.descripcion;
    case "@nivel": {
      const h = buscarValor(o.props, ALIAS_NIVEL);
      return h && !estaVacio(h.valor) ? String(h.valor).trim() : "";
    }
    default: {
      const alias = leerAlias(campo);
      if (!alias) return "";
      const h = buscarValor(o.props, [alias]);
      return h && !estaVacio(h.valor) ? String(h.valor).trim() : "";
    }
  }
}

export function cumpleCondicion(o: ObjetoModelo, c: CondicionRegla): boolean {
  const valor = valorCampo(o, c.campo);
  if (c.operador === "existe") return valor !== "";
  if (c.operador === "no_existe") return valor === "";
  const a = c.campo === "@clase" ? claseBase(valor) : normalizarNombre(valor);
  const b = c.campo === "@clase" ? claseBase(c.valor) : normalizarNombre(c.valor);
  switch (c.operador) {
    case "igual":
      return a === b;
    case "distinto":
      return a !== b;
    case "contiene":
      return b !== "" && a.includes(b);
    case "no_contiene":
      return b === "" || !a.includes(b);
    case "empieza":
      return b !== "" && a.startsWith(b);
  }
}

export function cumpleRegla(o: ObjetoModelo, regla: ReglaAsociacion | null): boolean {
  if (!regla || regla.condiciones.length === 0) return false;
  return regla.modo === "todas" ? regla.condiciones.every((c) => cumpleCondicion(o, c)) : regla.condiciones.some((c) => cumpleCondicion(o, c));
}

/** "Clase IFC es IfcSlab y Tipo contiene LOSA". */
export function textoRegla(regla: ReglaAsociacion | null): string {
  if (!regla || regla.condiciones.length === 0) return "Sin regla";
  const partes = regla.condiciones.map((c) => `${nombreCampo(c.campo)} ${OPERADORES[c.operador]}${c.operador === "existe" || c.operador === "no_existe" ? "" : ` "${c.valor}"`}`);
  return partes.join(regla.modo === "todas" ? " y " : " o ");
}

/** A starting rule from the element's IFC class (null without a class). */
export function reglaDesdeClase(claseIfc: string): ReglaAsociacion | null {
  return claseIfc ? { modo: "todas", condiciones: [{ campo: "@clase", operador: "igual", valor: claseIfc }] } : null;
}

// ---------------------------------------------------------------- classifying

export type Origen = "manual" | "regla";

export interface Clasificado {
  elementoId: string;
  origen: Origen;
  /** Other elements whose rules also match (the first one in order wins). */
  tambien: string[];
}

export interface ResultadoClasificacion {
  /** By "fileId:runtimeId". */
  porObjeto: Map<string, Clasificado>;
  /** Objects of the assigned models that match nothing (and aren't containers). */
  sinClasificar: { fileId: string; objeto: ObjetoModelo }[];
  /** By element: how many objects, by rule and by hand. */
  porElemento: Map<string, { regla: number; manual: number }>;
  /** Objects matched by more than one rule. */
  ambiguos: number;
  /** Containers left out (project, levels, openings…). */
  ignorados: number;
  /** Models read that have no discipline assigned (their objects aren't classified). */
  modelosSinDisciplina: string[];
  /** Objects without IFCGUID in the assigned models. */
  sinGuid: number;
}

export const claveObjeto = (fileId: string, runtimeId: number) => `${fileId}:${runtimeId}`;

export function clasificar(
  modelos: ModeloLeido[],
  disciplinasDeModelo: Map<string, string[]>,
  disciplinas: Disciplina[],
  elementos: Elemento[],
  manuales: Map<string, string>
): ResultadoClasificacion {
  const r: ResultadoClasificacion = { porObjeto: new Map(), sinClasificar: [], porElemento: new Map(), ambiguos: 0, ignorados: 0, modelosSinDisciplina: [], sinGuid: 0 };
  const activos = new Map(elementos.filter((e) => e.activo).map((e) => [e.id, e]));
  const ordenDisciplina = new Map(disciplinas.map((d) => [d.id, d.orden]));
  const disciplinaActiva = new Set(disciplinas.filter((d) => d.activo).map((d) => d.id));
  const contar = (id: string, origen: Origen) => {
    const c = r.porElemento.get(id) ?? { regla: 0, manual: 0 };
    c[origen]++;
    r.porElemento.set(id, c);
  };

  for (const m of modelos) {
    const ids = (disciplinasDeModelo.get(m.fileId) ?? []).filter((d) => disciplinaActiva.has(d));
    if (ids.length === 0) {
      r.modelosSinDisciplina.push(m.nombre);
      continue;
    }
    // The candidates of this model, in the disciplines' order and then the elements'.
    const candidatos = [...activos.values()]
      .filter((e) => ids.includes(e.disciplinaId) && e.regla && e.regla.condiciones.length > 0)
      .sort((a, b) => (ordenDisciplina.get(a.disciplinaId) ?? 0) - (ordenDisciplina.get(b.disciplinaId) ?? 0) || a.orden - b.orden || a.codigo.localeCompare(b.codigo));

    for (const o of m.objetos) {
      const clave = claveObjeto(m.fileId, o.runtimeId);
      const manual = o.ifcGuid ? manuales.get(o.ifcGuid) : undefined;
      if (manual && activos.has(manual)) {
        r.porObjeto.set(clave, { elementoId: manual, origen: "manual", tambien: [] });
        contar(manual, "manual");
        continue;
      }
      const coinciden = candidatos.filter((e) => cumpleRegla(o, e.regla));
      if (coinciden.length > 0) {
        r.porObjeto.set(clave, { elementoId: coinciden[0].id, origen: "regla", tambien: coinciden.slice(1).map((e) => e.id) });
        contar(coinciden[0].id, "regla");
        if (coinciden.length > 1) r.ambiguos++;
        if (!o.ifcGuid) r.sinGuid++;
        continue;
      }
      if (CLASES_IGNORADAS.has(claseBase(o.clase))) {
        r.ignorados++;
        continue;
      }
      r.sinClasificar.push({ fileId: m.fileId, objeto: o });
      if (!o.ifcGuid) r.sinGuid++;
    }
  }
  return r;
}

/** The unclassified objects grouped by class and type, biggest groups first (to see what is missing a rule). */
export function resumenSinClasificar(lista: { objeto: ObjetoModelo }[]): { clase: string; tipo: string; cantidad: number }[] {
  const grupos = new Map<string, { clase: string; tipo: string; cantidad: number }>();
  for (const { objeto } of lista) {
    const k = `${objeto.clase}|${objeto.tipo}`;
    const g = grupos.get(k) ?? { clase: objeto.clase || "(sin clase)", tipo: objeto.tipo || objeto.nombre || "(sin tipo)", cantidad: 0 };
    g.cantidad++;
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad || a.clase.localeCompare(b.clase));
}

/** The group / property names of the objects read, with how many objects carry each (most common first). */
export function camposDeModelos(modelos: ModeloLeido[], max = 3000): { grupo: string; propiedad: string; cuenta: number }[] {
  const cuenta = new Map<string, { grupo: string; propiedad: string; cuenta: number }>();
  for (const m of modelos) {
    for (const o of m.objetos) {
      const vistos = new Set<string>();
      for (const g of o.props.grupos) {
        for (const p of g.propiedades) {
          const k = `${g.nombre}\u0000${p.nombre}`;
          if (vistos.has(k)) continue;
          vistos.add(k);
          const c = cuenta.get(k) ?? { grupo: g.nombre, propiedad: p.nombre, cuenta: 0 };
          c.cuenta++;
          cuenta.set(k, c);
        }
      }
    }
  }
  return [...cuenta.values()].sort((a, b) => b.cuenta - a.cuenta || a.grupo.localeCompare(b.grupo) || a.propiedad.localeCompare(b.propiedad)).slice(0, max);
}

/** The most common values of a field in the objects read (to suggest what to write in a condition). */
export function valoresFrecuentes(modelos: ModeloLeido[], campo: string, max = 40): { valor: string; cuenta: number }[] {
  const cuenta = new Map<string, number>();
  for (const m of modelos) for (const o of m.objetos) {
    const v = valorCampo(o, campo);
    if (v) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  return [...cuenta].map(([valor, n]) => ({ valor, cuenta: n })).sort((a, b) => b.cuenta - a.cuenta || a.valor.localeCompare(b.valor)).slice(0, max);
}

/** The objects a rule matches in some models (for "Probar regla"). */
export function probarRegla(modelos: ModeloLeido[], regla: ReglaAsociacion | null): { fileId: string; viewerModelId: string; objetos: ObjetoModelo[] }[] {
  return modelos.map((m) => ({ fileId: m.fileId, viewerModelId: m.viewerModelId, objetos: m.objetos.filter((o) => cumpleRegla(o, regla)) })).filter((x) => x.objetos.length > 0);
}
