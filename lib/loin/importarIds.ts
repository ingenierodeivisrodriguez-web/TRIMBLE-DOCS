// Reading an IDS file (from the client's EIR, another tool, or one exported
// here) and planning what it adds to the project: each specification goes to
// an element (an existing one or a new one), each property or attribute it
// requires to a catalog parameter (found by where it's read, its URI or its
// name, or a new one). Nothing is overwritten silently: what already exists
// with different data is listed and changes only when the person ticks it.
import { coincideGrupo, normalizarNombre } from "./alias";
import { claseBase, nombreClaseIfc, reglaDesdeClase } from "./clasificacion";
import { categoriaTipoIfc, factorSi } from "./ids";
import { codigoLibre } from "./plantillas";
import { describirRegla, errorPatron } from "./reglas";
import type { Alias, Elemento, ElementoData, Ndi, Parametro, ParametroData, ParametroExigido, ReglaValor, TipoDato } from "./types";
import { REGLA_VACIA } from "./types";
import { ErrorXml, hijo, hijos, leerXml, NodoXml } from "./xml";

// ---------------------------------------------------------------- reading

/** A value restriction as written in the IDS. */
export interface ValorIds {
  simple?: string;
  enumeracion?: string[];
  patron?: string;
  min?: { valor: number; incluido: boolean };
  max?: { valor: number; incluido: boolean };
}

export interface RequisitoLeido {
  tipo: "propiedad" | "atributo";
  /** The property set as a catalog group ("*" wildcards), "@" for an attribute. */
  grupo: string;
  nombre: string;
  cardinalidad: "required" | "optional" | "prohibited";
  /** IFC data type ("" when the IDS doesn't give it). */
  tipoIfc: string;
  valor: ValorIds | null;
  uri: string;
  instrucciones: string;
}

export interface EspecificacionLeida {
  nombre: string;
  identificador: string;
  descripcion: string;
  instrucciones: string;
  /** IFC class in upper case ("IFCWALL"), "" when it has none. */
  clase: string;
  tipoPredefinido: string;
  requisitos: RequisitoLeido[];
  /** What of it isn't imported. */
  avisos: string[];
}

export interface IdsLeido {
  titulo: string;
  descripcion: string;
  hito: string;
  proposito: string;
  especificaciones: EspecificacionLeida[];
}

const texto = (n: NodoXml | null) => n?.texto ?? "";

function leerValor(n: NodoXml | null): ValorIds | null {
  if (!n) return null;
  const simple = hijo(n, "simpleValue");
  if (simple) return { simple: simple.texto };
  const r = hijo(n, "restriction");
  if (!r) return null;
  const v: ValorIds = {};
  const enumeracion = hijos(r, "enumeration").map((e) => e.atributos.value ?? "");
  if (enumeracion.length) v.enumeracion = enumeracion;
  // Several pattern facets in one restriction are alternatives.
  const patrones = hijos(r, "pattern").map((e) => e.atributos.value ?? "");
  if (patrones.length) v.patron = patrones.length === 1 ? patrones[0] : patrones.map((p) => `(${p})`).join("|");
  const largo = hijo(r, "length")?.atributos.value;
  const minLargo = hijo(r, "minLength")?.atributos.value;
  const maxLargo = hijo(r, "maxLength")?.atributos.value;
  if (!v.patron && (largo || minLargo || maxLargo)) v.patron = largo ? `.{${largo}}` : `.{${minLargo ?? 0},${maxLargo ?? ""}}`;
  const num = (nombre: string) => {
    const x = hijo(r, nombre)?.atributos.value;
    const n = x === undefined ? NaN : Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const minI = num("minInclusive");
  const minE = num("minExclusive");
  const maxI = num("maxInclusive");
  const maxE = num("maxExclusive");
  if (minI !== null) v.min = { valor: minI, incluido: true };
  else if (minE !== null) v.min = { valor: minE, incluido: false };
  if (maxI !== null) v.max = { valor: maxI, incluido: true };
  else if (maxE !== null) v.max = { valor: maxE, incluido: false };
  return v;
}

/** A name restriction (property set, entity) as a catalog glob, or null when it's more than literal text and ".*". */
export function globDesdePatron(patron: string): string | null {
  const partes = patron.split(".*");
  const literales: string[] = [];
  for (const parte of partes) {
    let lit = "";
    for (let i = 0; i < parte.length; i++) {
      const c = parte[i];
      if (c === "\\") {
        const n = parte[i + 1];
        if (n === undefined || /[a-zA-Z]/.test(n)) return null;
        lit += n;
        i++;
      } else if (".?*+(){}|[]^$".includes(c)) return null;
      else lit += c;
    }
    literales.push(lit);
  }
  return literales.join("*");
}

/** The names a name value allows: a simple value, a list, or a pattern of alternatives ("IFCWALL|IFCWALLSTANDARDCASE"). */
function nombresDe(v: ValorIds | null): { nombres: string[]; glob: string | null } {
  if (!v) return { nombres: [], glob: null };
  if (v.simple !== undefined) return { nombres: [v.simple.trim()], glob: null };
  if (v.enumeracion) return { nombres: v.enumeracion.map((x) => x.trim()), glob: null };
  if (v.patron) {
    const alternativas = v.patron.split("|").map((p) => globDesdePatron(p.replace(/^\((.*)\)$/, "$1")));
    if (alternativas.every((a) => a !== null && !a.includes("*"))) return { nombres: alternativas as string[], glob: null };
    return { nombres: [], glob: alternativas.length === 1 ? alternativas[0] : null };
  }
  return { nombres: [], glob: null };
}

const CARDINALIDADES = ["required", "optional", "prohibited"] as const;
const FACETAS: Record<string, string> = { classification: "clasificación", material: "material", partOf: "pertenencia (partOf)", entity: "clase IFC", property: "propiedad", attribute: "atributo" };

/** Reads an IDS file. Throws with a readable message when it isn't one. */
export function leerIds(xml: string): IdsLeido {
  let raiz: NodoXml;
  try {
    raiz = leerXml(xml);
  } catch (err) {
    throw new Error(`El archivo no es un XML válido: ${err instanceof ErrorXml ? err.message : "no se pudo leer"}.`);
  }
  if (raiz.nombre !== "ids") throw new Error("El archivo no es un IDS: su elemento principal no es <ids>.");
  const info = hijo(raiz, "info");
  const especificaciones: EspecificacionLeida[] = [];
  for (const s of hijos(hijo(raiz, "specifications"), "specification")) {
    const avisos: string[] = [];
    const ap = hijo(s, "applicability");
    const entidad = hijo(ap, "entity");
    let clase = "";
    let tipoPredefinido = "";
    if (entidad) {
      const { nombres } = nombresDe(leerValor(hijo(entidad, "name")));
      const bases = [...new Set(nombres.map((n) => claseBase(n)))];
      if (bases.length === 0) avisos.push("su clase IFC es un patrón que no se puede leer: elige el elemento a mano");
      else {
        clase = bases[0].toUpperCase();
        if (bases.length > 1) avisos.push(`aplica a varias clases (${nombres.length > 6 ? `${nombres.slice(0, 5).join(", ")} y ${nombres.length - 5} más` : nombres.join(", ")}); se toma ${nombreClaseIfc(clase)}`);
      }
      const tipo = nombresDe(leerValor(hijo(entidad, "predefinedType")));
      tipoPredefinido = tipo.nombres[0]?.toUpperCase() ?? "";
      if (tipo.nombres.length > 1) avisos.push(`admite varios tipos predefinidos (${tipo.nombres.join(", ")}); se toma ${tipoPredefinido}`);
    } else avisos.push("no dice a qué clase IFC aplica: elige el elemento a mano");
    const otras = (ap?.hijos ?? []).filter((h) => h.nombre !== "entity").map((h) => FACETAS[h.nombre] ?? h.nombre);
    if (otras.length) avisos.push(`su aplicabilidad tiene además ${[...new Set(otras)].join(", ")}: revisa la regla de asociación del elemento`);

    const requisitos: RequisitoLeido[] = [];
    for (const f of hijo(s, "requirements")?.hijos ?? []) {
      if (f.nombre !== "property" && f.nombre !== "attribute") {
        avisos.push(`no se importa un requisito de ${FACETAS[f.nombre] ?? f.nombre}`);
        continue;
      }
      const cardinalidad = CARDINALIDADES.find((c) => c === f.atributos.cardinality) ?? "required";
      const comun = { cardinalidad, valor: leerValor(hijo(f, "value")), uri: f.atributos.uri ?? "", instrucciones: (f.atributos.instructions ?? "").trim() };
      if (f.nombre === "attribute") {
        const n = nombresDe(leerValor(hijo(f, "name")));
        if (n.nombres.length !== 1) {
          avisos.push("un atributo con nombre variable no se importa");
          continue;
        }
        requisitos.push({ tipo: "atributo", grupo: "@", nombre: n.nombres[0], tipoIfc: "", ...comun });
        continue;
      }
      const nombre = nombresDe(leerValor(hijo(f, "baseName")));
      if (nombre.nombres.length !== 1) {
        avisos.push("una propiedad con nombre variable no se importa");
        continue;
      }
      const pset = nombresDe(leerValor(hijo(f, "propertySet")));
      let grupo = pset.nombres[0] ?? pset.glob ?? "";
      if (!grupo) {
        avisos.push(`el grupo de ${nombre.nombres[0]} es un patrón que no se puede leer: se busca en cualquier grupo`);
        grupo = "*";
      } else if (pset.nombres.length > 1) avisos.push(`${nombre.nombres[0]} admite varios grupos (${pset.nombres.join(", ")}); se toma ${grupo}`);
      requisitos.push({ tipo: "propiedad", grupo, nombre: nombre.nombres[0], tipoIfc: (f.atributos.dataType ?? "").toUpperCase(), ...comun });
    }
    especificaciones.push({
      nombre: (s.atributos.name ?? "").trim() || "(sin nombre)",
      identificador: (s.atributos.identifier ?? "").trim(),
      descripcion: (s.atributos.description ?? "").trim(),
      instrucciones: (s.atributos.instructions ?? "").trim(),
      clase,
      tipoPredefinido,
      requisitos,
      avisos,
    });
  }
  if (especificaciones.length === 0) throw new Error("El IDS no tiene especificaciones.");
  return { titulo: texto(hijo(info, "title")), descripcion: texto(hijo(info, "description")), hito: texto(hijo(info, "milestone")), proposito: texto(hijo(info, "purpose")), especificaciones };
}

// ---------------------------------------------------------------- matching the catalog

const plegado = (t: string) => normalizarNombre(t);
const claveRequisito = (r: Pick<RequisitoLeido, "grupo" | "nombre">) => `${plegado(r.grupo)}|${plegado(r.nombre)}`;
const aliasDe = (r: RequisitoLeido): Alias => ({ grupo: r.grupo, propiedad: r.nombre, sugerida: false });

/** The active catalog parameter a requirement is: by where it's read, then its URI, then its name. */
export function buscarParametro(r: RequisitoLeido, catalogo: Parametro[]): { parametro: Parametro; por: "equivalencia" | "uri" | "nombre" } | null {
  const activos = catalogo.filter((p) => p.activo);
  // A catalog group with wildcards covers the IDS group ("Qto_*BaseQuantities" reads Qto_WallBaseQuantities).
  // The exact group wins: "Qto_SlabBaseQuantities.Width" is Grosor even if Ancho reads "Qto_*BaseQuantities.Width".
  const exacto = (a: Alias) => (a.grupo === "@" || r.grupo === "@" ? a.grupo === r.grupo : plegado(a.grupo) === plegado(r.grupo));
  const cubre = (a: Alias) => a.grupo !== "@" && r.grupo !== "@" && coincideGrupo(a.grupo, r.grupo);
  const conAlias = (mismoGrupo: (a: Alias) => boolean) => activos.find((p) => p.alias.some((a) => mismoGrupo(a) && plegado(a.propiedad) === plegado(r.nombre)));
  const porAlias = conAlias(exacto) ?? conAlias(cubre);
  if (porAlias) return { parametro: porAlias, por: "equivalencia" };
  const uri = r.uri.trim();
  const porUri = uri ? activos.find((p) => p.idsUri.trim() === uri) : undefined;
  if (porUri) return { parametro: porUri, por: "uri" };
  const porNombre = activos.find((p) => plegado(p.nombre) === plegado(r.nombre));
  return porNombre ? { parametro: porNombre, por: "nombre" } : null;
}

// SI unit of each IFC measure, as the catalog writes it (angles in degrees, as the models show them).
const UNIDAD_SI: Record<string, string> = {
  IFCLENGTHMEASURE: "m",
  IFCPOSITIVELENGTHMEASURE: "m",
  IFCNONNEGATIVELENGTHMEASURE: "m",
  IFCAREAMEASURE: "m²",
  IFCVOLUMEMEASURE: "m³",
  IFCPLANEANGLEMEASURE: "°",
  IFCPOSITIVEPLANEANGLEMEASURE: "°",
  IFCMASSMEASURE: "kg",
  IFCELECTRICCURRENTMEASURE: "A",
  IFCELECTRICVOLTAGEMEASURE: "V",
  IFCPOWERMEASURE: "W",
  IFCPRESSUREMEASURE: "Pa",
  IFCFORCEMEASURE: "N",
  IFCTIMEMEASURE: "s",
  IFCTHERMALTRANSMITTANCEMEASURE: "W/(m²·K)",
};

const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const redondear = (n: number) => Number(n.toPrecision(10));

/** What kind of catalog parameter a requirement is. */
function tipoDatoDe(r: RequisitoLeido): TipoDato {
  const c = r.tipoIfc ? categoriaTipoIfc(r.tipoIfc) : null;
  if (c === "booleano" || c === "fecha" || c === "numero") return c;
  if (r.valor?.enumeracion?.length) return "lista";
  if (!c && (r.valor?.min || r.valor?.max)) return "numero";
  return "texto";
}

/**
 * The rule an IDS value means for a parameter of this type and unit (bounds
 * converted from the IDS's SI unit to the catalog's), plus what can't be kept.
 */
export function reglaDesdeValor(r: RequisitoLeido, tipoDato: TipoDato, unidad: string): { regla: ReglaValor; valores: string[]; avisos: string[] } {
  const regla: ReglaValor = { ...REGLA_VACIA };
  const avisos: string[] = [];
  let valores: string[] = [];
  const v = r.valor;
  if (!v) return { regla, valores, avisos };
  if (tipoDato === "numero") {
    const factor = factorSi(unidad, r.tipoIfc || "IFCREAL") ?? 1;
    const aCatalogo = (n: number) => redondear(n / factor);
    if (v.simple !== undefined && Number.isFinite(Number(v.simple))) regla.min = regla.max = aCatalogo(Number(v.simple));
    if (v.min) regla.min = aCatalogo(v.min.valor);
    if (v.max) regla.max = aCatalogo(v.max.valor);
    if ((v.min && !v.min.incluido) || (v.max && !v.max.incluido)) avisos.push("un límite del IDS excluye su valor (> o <); en la app queda incluido");
    if (v.enumeracion || v.patron) avisos.push("su lista o patrón de números no se importa");
  } else if (tipoDato === "lista") {
    valores = v.enumeracion ?? (v.simple !== undefined ? [v.simple] : []);
    if (v.patron) avisos.push("su patrón no se importa (la lista sí)");
  } else if (tipoDato === "texto") {
    if (v.patron) {
      if (errorPatron(v.patron)) avisos.push(`su patrón ${v.patron} no se puede usar aquí y no se importa`);
      else regla.patron = v.patron;
    } else if (v.simple !== undefined) regla.patron = escaparRegex(v.simple);
    else if (v.enumeracion) regla.patron = v.enumeracion.map(escaparRegex).join("|");
  } else if (v.simple !== undefined || v.enumeracion || v.patron) {
    avisos.push(`pide un valor concreto (${v.simple ?? v.enumeracion?.join(", ") ?? v.patron}); la app solo revisa que tenga un valor válido`);
  }
  return { regla, valores, avisos };
}

export interface ParametroNuevo {
  clave: string;
  datos: ParametroData;
  avisos: string[];
}

/** A new catalog parameter for a requirement the catalog doesn't have. */
export function parametroDesdeRequisito(r: RequisitoLeido, codigo: string, tdi: string, ndi: Ndi): ParametroNuevo {
  const tipoDato = tipoDatoDe(r);
  const unidad = tipoDato === "numero" ? (UNIDAD_SI[r.tipoIfc] ?? "") : "";
  const { regla, valores, avisos } = reglaDesdeValor(r, tipoDato, unidad);
  if (tipoDato === "lista" && valores.length === 0) avisos.push("es una lista sin valores");
  return {
    clave: claveRequisito(r),
    datos: {
      codigo,
      numero: null,
      nombre: r.nombre,
      descripcion: r.instrucciones,
      tdi,
      ndi,
      origen: /^qto_/i.test(r.grupo) ? "automatica" : "a_ingresar",
      tipoDato: tipoDato === "lista" && valores.length === 0 ? "texto" : tipoDato,
      unidad,
      valoresPermitidos: valores,
      regla,
      alias: [aliasDe(r)],
      idsUri: /^https?:\/\/\S+$/i.test(r.uri.trim()) ? r.uri.trim() : "",
      activo: true,
    },
    avisos,
  };
}

// Patterns are matched against the whole value either way, so "^A.*$" and "A.*" are the same rule.
const patronNormal = (p: string) => p.trim().replace(/^\^/, "").replace(/(^|[^\\])\$$/, "$1");
const mismaRegla = (a: ReglaValor, b: ReglaValor) => a.min === b.min && a.max === b.max && patronNormal(a.patron) === patronNormal(b.patron);

// ---------------------------------------------------------------- the plan

export type AccionFila = "agregar" | "igual" | "cambiar" | "omitir";

export interface FilaPlan {
  requisito: RequisitoLeido;
  /** The catalog parameter (existing id, or the code of a new one). */
  parametroId: string | null;
  nuevo: string | null;
  accion: AccionFila;
  obligatorio: boolean;
  /** The element's own rule (null: the catalog's). */
  regla: ReglaValor | null;
  /** What changes, or why it's left out. */
  detalle: string;
}

export interface PlanIds {
  /** Parameters to create, by requirement key (group|name). */
  nuevos: Map<string, ParametroNuevo>;
  /** Existing parameters found by URI or name whose aliases lack where the IDS reads them. */
  equivalencias: { parametro: Parametro; alias: Alias }[];
  /** Per specification: the element suggested for it (null: none found). */
  especificaciones: { leida: EspecificacionLeida; elementoId: string | null }[];
}

export interface OpcionesPlan {
  catalogo: Parametro[];
  elementos: Elemento[];
  /** Codes of the disciplines, to recognize "ARQ · Muro" (the names this app exports). */
  disciplinas: { id: string; codigo: string }[];
  tdi: string;
  /** TDI group for quantities (Qto_), when the catalog has one for them. */
  tdiCantidades: string | null;
  ndi: Ndi;
}

/** The element a specification most likely is: its code, its name ("ARQ · Muro") or the only one of its class and type. */
export function elementoSugerido(s: EspecificacionLeida, o: Pick<OpcionesPlan, "elementos" | "disciplinas">): string | null {
  const activos = o.elementos.filter((e) => e.activo);
  if (s.identificador) {
    const e = activos.find((x) => plegado(x.codigo) === plegado(s.identificador));
    if (e) return e.id;
  }
  const i = s.nombre.indexOf(" · ");
  if (i > 0) {
    const disc = o.disciplinas.find((d) => plegado(d.codigo) === plegado(s.nombre.slice(0, i)));
    const e = disc && activos.find((x) => x.disciplinaId === disc.id && plegado(x.nombre) === plegado(s.nombre.slice(i + 3)));
    if (e) return e.id;
  }
  if (!s.clase) return null;
  const mismos = activos.filter((x) => x.claseIfc && claseBase(x.claseIfc) === claseBase(s.clase) && plegado(x.tipoPredefinido) === plegado(s.tipoPredefinido));
  return mismos.length === 1 ? mismos[0].id : null;
}

/** The parameters to create and the aliases to propose for a whole IDS. */
export function planIds(ids: IdsLeido, o: OpcionesPlan): PlanIds {
  const nuevos = new Map<string, ParametroNuevo>();
  const equivalencias = new Map<string, { parametro: Parametro; alias: Alias }>();
  const usados = o.catalogo.map((p) => p.codigo);
  let n = 0;
  for (const s of ids.especificaciones) {
    for (const r of s.requisitos) {
      if (r.cardinalidad === "prohibited") continue;
      const hallado = buscarParametro(r, o.catalogo);
      if (hallado) {
        if (hallado.por !== "equivalencia" && r.tipo === "propiedad") equivalencias.set(`${hallado.parametro.id}|${claveRequisito(r)}`, { parametro: hallado.parametro, alias: aliasDe(r) });
        continue;
      }
      const k = claveRequisito(r);
      if (nuevos.has(k)) continue;
      let codigo = "";
      do codigo = `IDS-${String(++n).padStart(3, "0")}`;
      while (usados.some((c) => plegado(c) === plegado(codigo)));
      usados.push(codigo);
      const tdi = /^qto_/i.test(r.grupo) && o.tdiCantidades ? o.tdiCantidades : o.tdi;
      nuevos.set(k, parametroDesdeRequisito(r, codigo, tdi, o.ndi));
    }
  }
  return {
    nuevos,
    equivalencias: [...equivalencias.values()],
    especificaciones: ids.especificaciones.map((leida) => ({ leida, elementoId: elementoSugerido(leida, o) })),
  };
}

const textoRegla = (r: ReglaValor | null, unidad: string) => (r ? describirRegla(r, unidad) || "sin regla" : "la del catálogo");

/**
 * The rows of one specification for an element (null: a new element). A
 * parameter the element doesn't require yet is added (with the IDS's rule as
 * its own when it differs from the catalog's); one it already requires with
 * another obligation or rule is a change, applied only when ticked.
 */
export function filasEspecificacion(s: EspecificacionLeida, elemento: Pick<ElementoData, "parametros"> | null, catalogo: Parametro[], plan: Pick<PlanIds, "nuevos">): FilaPlan[] {
  const filas: FilaPlan[] = [];
  const vistos = new Set<string>();
  for (const r of s.requisitos) {
    const base = { requisito: r, obligatorio: r.cardinalidad === "required", regla: null as ReglaValor | null };
    if (r.cardinalidad === "prohibited") {
      filas.push({ ...base, parametroId: null, nuevo: null, accion: "omitir", detalle: "El IDS lo prohíbe; la app no maneja parámetros prohibidos." });
      continue;
    }
    const hallado = buscarParametro(r, catalogo);
    const nuevo = hallado ? null : plan.nuevos.get(claveRequisito(r)) ?? null;
    const p = hallado?.parametro ?? null;
    const id = p?.id ?? nuevo?.datos.codigo ?? null;
    if (!id) continue;
    if (vistos.has(id)) {
      filas.push({ ...base, parametroId: p?.id ?? null, nuevo: nuevo?.datos.codigo ?? null, accion: "omitir", detalle: "Ya está en esta especificación con otra ubicación." });
      continue;
    }
    vistos.add(id);
    // The IDS rule is the element's own only for existing parameters; a new one takes it as its catalog rule.
    let regla: ReglaValor | null = null;
    const avisos: string[] = [];
    if (p) {
      const leida = reglaDesdeValor(r, p.tipoDato, p.unidad);
      avisos.push(...leida.avisos);
      if (r.valor && !mismaRegla(leida.regla, p.regla) && p.tipoDato !== "lista" && p.tipoDato !== "booleano" && p.tipoDato !== "fecha") regla = leida.regla;
      if (p.tipoDato === "lista" && leida.valores.length && leida.valores.join("|") !== p.valoresPermitidos.join("|")) avisos.push("la lista de valores del IDS es distinta a la del catálogo (no se cambia)");
    } else if (nuevo) avisos.push(...nuevo.avisos);
    const unidad = p?.unidad ?? nuevo?.datos.unidad ?? "";
    const actual = elemento?.parametros.find((x) => x.parametroId === id) ?? null;
    const sufijo = avisos.length ? ` (${avisos.join("; ")})` : "";
    if (!actual) {
      const queRegla = regla ? `, con regla propia: ${textoRegla(regla, unidad)}` : "";
      filas.push({ ...base, parametroId: p?.id ?? null, nuevo: nuevo?.datos.codigo ?? null, regla, accion: "agregar", detalle: `Se agrega ${base.obligatorio ? "obligatorio" : "opcional"}${queRegla}.${sufijo}` });
      continue;
    }
    const cambios: string[] = [];
    if (actual.obligatorio !== base.obligatorio) cambios.push(`${actual.obligatorio ? "obligatorio" : "opcional"} → ${base.obligatorio ? "obligatorio" : "opcional"}`);
    const reglaFinal = regla ?? actual.regla;
    if (regla && !(actual.regla && mismaRegla(actual.regla, regla))) cambios.push(`regla: ${textoRegla(actual.regla, unidad)} → ${textoRegla(regla, unidad)}`);
    filas.push({
      ...base,
      parametroId: p?.id ?? null,
      nuevo: null,
      regla: reglaFinal,
      accion: cambios.length ? "cambiar" : "igual",
      detalle: cambios.length ? `Ya lo exige: ${cambios.join("; ")}.${sufijo}` : `Ya lo exige igual.${sufijo}`,
    });
  }
  return filas;
}

/** The element's required parameters after applying the ticked rows ("agregar" / "cambiar"). */
export function aplicarFilas(actuales: ParametroExigido[], filas: FilaPlan[], marcadas: Set<number>, idDeNuevo: Map<string, string>): ParametroExigido[] {
  const out = actuales.map((x) => ({ ...x }));
  filas.forEach((f, i) => {
    if (!marcadas.has(i) || (f.accion !== "agregar" && f.accion !== "cambiar")) return;
    const id = f.parametroId ?? (f.nuevo ? idDeNuevo.get(f.nuevo) : undefined);
    if (!id) return;
    const ya = out.find((x) => x.parametroId === id);
    if (ya) {
      ya.obligatorio = f.obligatorio;
      ya.regla = f.regla;
    } else out.push({ parametroId: id, obligatorio: f.obligatorio, ndi: null, regla: f.regla });
  });
  return out;
}

/** A new element for a specification, in a discipline. */
export function elementoDesdeEspecificacion(s: EspecificacionLeida, disciplina: { id: string; codigo: string }, usados: string[], orden: number): ElementoData {
  const i = s.nombre.indexOf(" · ");
  const nombre = (i > 0 && plegado(s.nombre.slice(0, i)) === plegado(disciplina.codigo) ? s.nombre.slice(i + 3) : s.nombre).slice(0, 200);
  const base = (s.identificador || nombre).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "").toUpperCase().slice(0, 24) || "ELEMENTO";
  const claseIfc = s.clase ? nombreClaseIfc(s.clase) : "";
  return {
    disciplinaId: disciplina.id,
    codigo: codigoLibre(base, usados),
    nombre,
    claseIfc,
    tipoPredefinido: s.tipoPredefinido,
    clasificacionSistema: "",
    clasificacionCodigo: "",
    notas: s.instrucciones.slice(0, 4000),
    parametros: [],
    regla: reglaDesdeClase(claseIfc),
    orden,
    activo: true,
  };
}
