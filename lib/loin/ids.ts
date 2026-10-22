// The stage's requirements as an IDS 1.0 file (buildingSMART Information
// Delivery Specification), so the designer checks the IFC before uploading it.
// One specification per element required at the stage: it applies to the
// element's IFC class (and predefined type) and requires the parameters of its
// NDI, each as a property (or an IFC attribute) where the catalog looks for it,
// required or optional, with its value rule when IDS can express it.
//
// Rules taken from the IDS 1.0 schema and manual (github.com/buildingSMART/IDS,
// tag v1.0.0): entity names in upper case and without automatic subtypes; a
// value or an optional property needs its IFC data type; measures are written
// in SI units (metres, radians, seconds…); booleans are "true" / "false";
// patterns are XML Schema regular expressions, anchored to the whole value.
import { descargar, nombreSeguro } from "../presupuesto/excel";
import { claseBase, variantesClase } from "./clasificacion";
import { clave } from "./matriz";
import { exigidosHasta, Exigencia } from "./ndi";
import type { CeldaMatriz, Disciplina, Elemento, Etapa, Parametro, ReglaValor } from "./types";
import { ElementoXml, escribirXml } from "./xml";

export const VERSIONES_IFC = ["IFC2X3", "IFC4", "IFC4X3_ADD2"] as const;
export type VersionIfc = (typeof VERSIONES_IFC)[number];

export const NS_IDS = "http://standards.buildingsmart.org/IDS";
const ESQUEMA_IDS = "http://standards.buildingsmart.org/IDS/1.0/ids.xsd";

// ---------------------------------------------------------------- data types and units

export type Categoria = "texto" | "numero" | "booleano" | "fecha" | "otro";

/** What kind of value an IFC data type holds. */
export function categoriaTipoIfc(tipo: string): Categoria {
  const t = tipo.toUpperCase();
  if (["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(t)) return "texto";
  if (["IFCBOOLEAN", "IFCLOGICAL"].includes(t)) return "booleano";
  if (["IFCDATE", "IFCDATETIME"].includes(t)) return "fecha";
  if (/MEASURE$/.test(t) || ["IFCREAL", "IFCINTEGER", "IFCNUMERIC"].includes(t)) return "numero";
  return "otro";
}

const categoriaDato = (tipo: Parametro["tipoDato"]): Categoria => (tipo === "lista" ? "texto" : tipo);

/** Units the catalog uses, the IFC measure they belong to and the factor to its SI unit (the one IDS uses). */
const UNIDADES: { nombres: string[]; tipo: string; factor: number }[] = [
  { nombres: ["m", "metro", "metros"], tipo: "IFCLENGTHMEASURE", factor: 1 },
  { nombres: ["mm"], tipo: "IFCLENGTHMEASURE", factor: 0.001 },
  { nombres: ["cm"], tipo: "IFCLENGTHMEASURE", factor: 0.01 },
  { nombres: ["m²", "m2"], tipo: "IFCAREAMEASURE", factor: 1 },
  { nombres: ["m³", "m3"], tipo: "IFCVOLUMEMEASURE", factor: 1 },
  { nombres: ["°", "º", "grados", "deg"], tipo: "IFCPLANEANGLEMEASURE", factor: Math.PI / 180 },
  { nombres: ["rad"], tipo: "IFCPLANEANGLEMEASURE", factor: 1 },
  { nombres: ["kg"], tipo: "IFCMASSMEASURE", factor: 1 },
  { nombres: ["t", "ton"], tipo: "IFCMASSMEASURE", factor: 1000 },
  { nombres: ["a", "amperios"], tipo: "IFCELECTRICCURRENTMEASURE", factor: 1 },
  { nombres: ["v", "voltios"], tipo: "IFCELECTRICVOLTAGEMEASURE", factor: 1 },
  { nombres: ["w"], tipo: "IFCPOWERMEASURE", factor: 1 },
  { nombres: ["kw"], tipo: "IFCPOWERMEASURE", factor: 1000 },
  { nombres: ["pa"], tipo: "IFCPRESSUREMEASURE", factor: 1 },
  { nombres: ["kpa"], tipo: "IFCPRESSUREMEASURE", factor: 1000 },
  { nombres: ["mpa"], tipo: "IFCPRESSUREMEASURE", factor: 1e6 },
  { nombres: ["n"], tipo: "IFCFORCEMEASURE", factor: 1 },
  { nombres: ["kn"], tipo: "IFCFORCEMEASURE", factor: 1000 },
  { nombres: ["s", "seg"], tipo: "IFCTIMEMEASURE", factor: 1 },
  { nombres: ["min"], tipo: "IFCTIMEMEASURE", factor: 60 },
  { nombres: ["h", "horas"], tipo: "IFCTIMEMEASURE", factor: 3600 },
  { nombres: ["días", "dias", "d"], tipo: "IFCTIMEMEASURE", factor: 86400 },
  { nombres: ["w/(m²·k)", "w/m²k", "w/m2k", "w/(m2·k)"], tipo: "IFCTHERMALTRANSMITTANCEMEASURE", factor: 1 },
];
// Measures a modeling tool writes as such for its own parameters (geometry); other units go as IFCREAL.
const MEDIDAS_GEOMETRICAS = ["IFCLENGTHMEASURE", "IFCAREAMEASURE", "IFCVOLUMEMEASURE", "IFCPLANEANGLEMEASURE"];
// Length measures share their unit.
const MISMA_UNIDAD: Record<string, string> = { IFCPOSITIVELENGTHMEASURE: "IFCLENGTHMEASURE", IFCNONNEGATIVELENGTHMEASURE: "IFCLENGTHMEASURE", IFCPOSITIVEPLANEANGLEMEASURE: "IFCPLANEANGLEMEASURE" };

const unidadDe = (unidad: string) => UNIDADES.find((u) => u.nombres.includes(unidad.trim().toLowerCase())) ?? null;

/** The factor from the catalog's unit to the SI unit of an IFC measure (1 for plain numbers); null when they don't match. */
export function factorSi(unidad: string, tipoIfc: string): number | null {
  const tipo = MISMA_UNIDAD[tipoIfc] ?? tipoIfc;
  if (!/MEASURE$/.test(tipo) || tipo === "IFCCOUNTMEASURE") return 1;
  const u = unidadDe(unidad);
  if (u) return u.tipo === tipo ? u.factor : null;
  return unidad.trim() ? null : 1;
}

// IFC 4.3 data types of the standard properties the catalog suggests (checked against the property set definitions).
const TIPOS_PSET: Record<string, string> = {
  firerating: "IFCLABEL",
  loadbearing: "IFCBOOLEAN",
  isexternal: "IFCBOOLEAN",
  status: "IFCLABEL",
  pitchangle: "IFCPLANEANGLEMEASURE",
  numberofriser: "IFCCOUNTMEASURE",
  numberoftreads: "IFCCOUNTMEASURE",
  occupancytype: "IFCLABEL",
  occupancynumber: "IFCCOUNTMEASURE",
  minimumheadroom: "IFCLENGTHMEASURE",
  publiclyaccessible: "IFCBOOLEAN",
  nominaldiameter: "IFCPOSITIVELENGTHMEASURE",
  ratedvoltage: "IFCELECTRICVOLTAGEMEASURE",
  ratedcurrent: "IFCELECTRICCURRENTMEASURE",
  numberofpoles: "IFCINTEGER",
  ip_code: "IFCLABEL",
  fireexit: "IFCBOOLEAN",
  acousticrating: "IFCLABEL",
  reference: "IFCIDENTIFIER",
  thermaltransmittance: "IFCTHERMALTRANSMITTANCEMEASURE",
  "pset_fastenerweld.a": "IFCPOSITIVELENGTHMEASURE",
  "pset_fastenerweld.type1": "IFCLABEL",
  "pset_fastenerweld.type2": "IFCLABEL",
};
const TIPOS_QTO: Record<string, string> = {
  length: "IFCLENGTHMEASURE",
  width: "IFCLENGTHMEASURE",
  height: "IFCLENGTHMEASURE",
  depth: "IFCLENGTHMEASURE",
  perimeter: "IFCLENGTHMEASURE",
  netarea: "IFCAREAMEASURE",
  grossarea: "IFCAREAMEASURE",
  netsidearea: "IFCAREAMEASURE",
  grosssidearea: "IFCAREAMEASURE",
  crosssectionarea: "IFCAREAMEASURE",
  outersurfacearea: "IFCAREAMEASURE",
  netfootprintarea: "IFCAREAMEASURE",
  grossfootprintarea: "IFCAREAMEASURE",
  netvolume: "IFCVOLUMEMEASURE",
  grossvolume: "IFCVOLUMEMEASURE",
  netweight: "IFCMASSMEASURE",
  grossweight: "IFCMASSMEASURE",
};

/** The IFC data type of a standard property (Pset_ / Qto_, or any group for the standard English names), or null. */
export function tipoEstandar(grupo: string, propiedad: string): string | null {
  const g = grupo.trim().toLowerCase();
  const p = propiedad.trim().toLowerCase();
  if (g.startsWith("qto_")) return TIPOS_QTO[p] ?? null;
  if (g.startsWith("pset_")) return TIPOS_PSET[`${g}.${p}`] ?? TIPOS_PSET[p] ?? null;
  if (g === "*") return TIPOS_PSET[p] ?? null;
  return null;
}

/** The data type for a catalog parameter read from a custom property (IFC2X3 has no IfcDate: dates go as labels there). */
function tipoPropio(p: Parametro, conIfc2x3: boolean): string {
  switch (p.tipoDato) {
    case "booleano":
      return "IFCBOOLEAN";
    case "fecha":
      return conIfc2x3 ? "IFCLABEL" : "IFCDATE";
    case "numero": {
      const u = unidadDe(p.unidad);
      return u && MEDIDAS_GEOMETRICAS.includes(u.tipo) ? u.tipo : "IFCREAL";
    }
    default:
      return "IFCLABEL";
  }
}

// ---------------------------------------------------------------- patterns

/**
 * A catalog pattern (JavaScript regular expression on the whole value) as an
 * XML Schema pattern, or why it can't be one. Leading ^ and trailing $ go
 * (XML Schema patterns are already anchored); lookarounds, lazy repeats,
 * back-references and word boundaries have no equivalent.
 */
export function patronXsd(patron: string): { ok: true; patron: string } | { ok: false; motivo: string } {
  let p = patron.trim();
  if (p.startsWith("^")) p = p.slice(1);
  if (/(^|[^\\])\$$/.test(p)) p = p.slice(0, -1);
  const especiales = ".?*+(){}|[]^-\\";
  let out = "";
  let enClase = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") {
      const n = p[i + 1];
      if (n === undefined) return { ok: false, motivo: "termina en \\" };
      const hex = p.slice(i + 2, i + 6);
      if (n === "u" && /^[0-9a-fA-F]{4}$/.test(hex)) {
        const ch = String.fromCharCode(parseInt(hex, 16));
        out += especiales.includes(ch) ? `\\${ch}` : ch;
        i += 5;
        continue;
      }
      if ("bBkxcfv0123456789u".includes(n)) return { ok: false, motivo: `usa \\${n}, que un IDS no admite` };
      // "$" and "/" are plain characters in XML Schema and can't be escaped there.
      out += n === "$" || n === "/" ? n : `\\${n}`;
      i++;
      continue;
    }
    if (enClase) {
      if (c === "]") enClase = false;
      out += c;
      continue;
    }
    if (c === "[") {
      enClase = true;
      out += c;
      if (p[i + 1] === "^") {
        out += "^";
        i++;
      }
      continue;
    }
    if (c === "(" && p[i + 1] === "?") return { ok: false, motivo: "usa grupos especiales (?…), que un IDS no admite" };
    if ("*+?}".includes(c) && p[i + 1] === "?") return { ok: false, motivo: "usa repeticiones perezosas (*?, +?), que un IDS no admite" };
    if (c === "^" || c === "$") return { ok: false, motivo: "usa ^ o $ en medio del patrón" };
    out += c;
  }
  return { ok: true, patron: out };
}

/** A catalog group with "*" wildcards as an XML Schema pattern ("Qto_*BaseQuantities" -> "Qto_.*BaseQuantities"). */
export function grupoComoPatron(grupo: string): string {
  return grupo
    .split("*")
    .map((s) => s.replace(/[.?+(){}|[\]^\\-]/g, "\\$&"))
    .join(".*");
}

// ---------------------------------------------------------------- one requirement

/** Where the IDS asks for a parameter. */
export type UbicacionIds = { tipo: "atributo"; nombre: string } | { tipo: "propiedad"; grupo: string; nombre: string };

// A standard IFC place: an attribute, a Pset_ / Qto_ set, or a standard property name in any set ("*.LoadBearing").
const esEstandar = (grupo: string, propiedad: string) => grupo === "@" || /^(pset|qto)_/i.test(grupo.trim()) || tipoEstandar(grupo, propiedad) !== null;

/**
 * The alias the IDS uses: the first one (the same order the audit follows) or,
 * with `preferirIfc`, the first standard IFC one (Pset_, Qto_ or an attribute)
 * when the parameter has it. Without aliases, its own name in any group.
 */
export function ubicacionIds(p: Parametro, preferirIfc = false): UbicacionIds {
  const a = (preferirIfc ? p.alias.find((x) => esEstandar(x.grupo, x.propiedad)) : undefined) ?? p.alias[0];
  if (!a) return { tipo: "propiedad", grupo: "*", nombre: p.nombre };
  return a.grupo === "@" ? { tipo: "atributo", nombre: a.propiedad } : { tipo: "propiedad", grupo: a.grupo, nombre: a.propiedad };
}

const numeroXml = (n: number) => String(Number(n.toPrecision(12)));
const recortar = (t: string, max: number) => (t.trim().length > max ? `${t.trim().slice(0, max - 1).trimEnd()}…` : t.trim());

export interface RequisitoGenerado {
  facet: ElementoXml;
  /** Something of the catalog's rule that the IDS can't carry. */
  avisos: string[];
}

/** One required parameter as an IDS requirement facet. */
export function requisitoIds(e: Exigencia, preferirIfc = false, conIfc2x3 = false): RequisitoGenerado {
  const p = e.parametro;
  const avisos: string[] = [];
  const u = ubicacionIds(p, preferirIfc);
  if (p.alias.length === 0) avisos.push("no tiene equivalencias de lectura: se pide por su nombre en cualquier grupo");
  const regla: ReglaValor = e.regla;
  const cardinalidad = e.obligatorio ? "required" : "optional";
  const instrucciones = recortar(p.descripcion, 500) || undefined;

  if (u.tipo === "atributo") {
    const valor = restriccion(p, regla, p.tipoDato === "numero" ? 1 : null, avisos, u.nombre);
    return {
      facet: { nombre: "ids:attribute", atributos: { cardinality: cardinalidad, instructions: instrucciones }, hijos: [valorSimple("ids:name", u.nombre), valor] },
      avisos,
    };
  }

  const estandar = tipoEstandar(u.grupo, u.nombre);
  const tipoIfc = estandar ?? tipoPropio(p, conIfc2x3);
  let valor: ElementoXml | null = null;
  const catDato = categoriaDato(p.tipoDato);
  const catIfc = categoriaTipoIfc(tipoIfc);
  const tieneRegla = (p.tipoDato === "numero" && (regla.min !== null || regla.max !== null)) || (p.tipoDato === "lista" && p.valoresPermitidos.length > 0) || (p.tipoDato === "texto" && !!regla.patron.trim());
  if (tieneRegla && catDato !== catIfc) {
    avisos.push(`en IFC ${u.nombre} es ${tipoIfc}: su regla (${p.tipoDato}) no va en el IDS`);
  } else if (tieneRegla) {
    const factor = p.tipoDato === "numero" ? factorSi(p.unidad, tipoIfc) : null;
    if (p.tipoDato === "numero" && factor === null) avisos.push(`la unidad "${p.unidad}" no corresponde a ${tipoIfc}: el rango no va en el IDS`);
    else valor = restriccion(p, regla, factor, avisos, u.nombre);
  }
  // The data type is written when IDS needs it (a value, or an optional property) and for standard properties, whose type is known.
  const conTipo = valor !== null || !e.obligatorio || estandar !== null;
  const uri = /^https?:\/\//i.test(p.idsUri.trim()) ? p.idsUri.trim() : undefined;
  const grupo = u.grupo.includes("*") ? patron("ids:propertySet", grupoComoPatron(u.grupo)) : valorSimple("ids:propertySet", u.grupo);
  return {
    facet: {
      nombre: "ids:property",
      atributos: { dataType: conTipo ? tipoIfc : undefined, uri, cardinality: cardinalidad, instructions: instrucciones },
      hijos: [grupo, valorSimple("ids:baseName", u.nombre), valor],
    },
    avisos,
  };
}

/** The value restriction of a rule (range, list or pattern), or null when there is none or it can't be written. */
function restriccion(p: Parametro, regla: ReglaValor, factor: number | null, avisos: string[], nombre: string): ElementoXml | null {
  if (p.tipoDato === "numero" && factor !== null && (regla.min !== null || regla.max !== null)) {
    return {
      nombre: "ids:value",
      hijos: [
        {
          nombre: "xs:restriction",
          atributos: { base: "xs:double" },
          hijos: [
            regla.min !== null ? { nombre: "xs:minInclusive", atributos: { value: numeroXml(regla.min * factor) } } : null,
            regla.max !== null ? { nombre: "xs:maxInclusive", atributos: { value: numeroXml(regla.max * factor) } } : null,
          ],
        },
      ],
    };
  }
  if (p.tipoDato === "lista" && p.valoresPermitidos.length > 0) {
    if (regla.patron.trim()) avisos.push("la lista de valores va en el IDS; su patrón no");
    return {
      nombre: "ids:value",
      hijos: [{ nombre: "xs:restriction", atributos: { base: "xs:string" }, hijos: p.valoresPermitidos.map((v) => ({ nombre: "xs:enumeration", atributos: { value: v } })) }],
    };
  }
  if (p.tipoDato === "texto" && regla.patron.trim()) {
    const x = patronXsd(regla.patron);
    if (!x.ok) {
      avisos.push(`el patrón de ${nombre} ${x.motivo}: no va en el IDS`);
      return null;
    }
    return { nombre: "ids:value", hijos: [{ nombre: "xs:restriction", atributos: { base: "xs:string" }, hijos: [{ nombre: "xs:pattern", atributos: { value: x.patron } }] }] };
  }
  return null;
}

const valorSimple = (nombre: string, valor: string): ElementoXml => ({ nombre, hijos: [{ nombre: "ids:simpleValue", texto: valor }] });
const patron = (nombre: string, valor: string): ElementoXml => ({
  nombre,
  hijos: [{ nombre: "xs:restriction", atributos: { base: "xs:string" }, hijos: [{ nombre: "xs:pattern", atributos: { value: valor } }] }],
});

// ---------------------------------------------------------------- the file

export interface DatosIds {
  proyecto: string;
  etapa: Etapa;
  /** The disciplines to include, in their order. */
  disciplinas: Disciplina[];
  elementos: Elemento[];
  celdas: Map<string, CeldaMatriz>;
  catalogo: Map<string, Parametro>;
  versiones: VersionIfc[];
  /** "AAAA-MM-DD" */
  fecha: string;
  preferirIfc?: boolean;
}

export interface ResultadoIds {
  xml: string;
  especificaciones: number;
  requisitos: number;
  /** Elements the IDS leaves out, and why. */
  omitidos: { elemento: string; motivo: string }[];
  /** Elements that share their IFC class without a predefined type to tell them apart. */
  compartidas: string[][];
  /** What the IDS can't carry, per parameter. */
  avisos: string[];
  /** Elements that require nothing at this stage (no NDI in the matrix). */
  sinExigencia: number;
}

/** The IDS of a stage. Throws when there is nothing to export. */
export function generarIds(d: DatosIds): ResultadoIds {
  if (d.versiones.length === 0) throw new Error("Elige al menos una versión de IFC.");
  const especificaciones: ElementoXml[] = [];
  const omitidos: ResultadoIds["omitidos"] = [];
  const avisosPorTexto = new Map<string, Set<string>>();
  const propositos = new Set<string>();
  const porClase = new Map<string, { nombre: string; tipo: string }[]>();
  let requisitos = 0;
  let sinExigencia = 0;

  for (const disc of d.disciplinas) {
    const elementos = d.elementos.filter((e) => e.disciplinaId === disc.id && e.activo).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
    for (const el of elementos) {
      const nombre = `${disc.codigo} · ${el.nombre}`;
      const celda = d.celdas.get(clave(el.id, d.etapa.id));
      if (!celda || celda.ndi === null) {
        sinExigencia++;
        continue;
      }
      if (!el.claseIfc.trim()) {
        omitidos.push({ elemento: nombre, motivo: "no tiene clase IFC" });
        continue;
      }
      const exigidos = exigidosHasta(el.parametros, d.catalogo, celda.ndi);
      if (exigidos.length === 0) {
        omitidos.push({ elemento: nombre, motivo: `pide NDI-${celda.ndi} pero no tiene parámetros exigidos de ese nivel` });
        continue;
      }
      const facets: ElementoXml[] = [];
      for (const e of exigidos) {
        const r = requisitoIds(e, d.preferirIfc, d.versiones.includes("IFC2X3"));
        facets.push(r.facet);
        for (const a of r.avisos) {
          const texto = `${e.parametro.codigo} · ${e.parametro.nombre}: ${a}`;
          avisosPorTexto.set(texto, (avisosPorTexto.get(texto) ?? new Set()).add(nombre));
        }
      }
      requisitos += facets.length;
      for (const p of celda.propositos) propositos.add(p);
      const base = claseBase(el.claseIfc);
      porClase.set(base, [...(porClase.get(base) ?? []), { nombre, tipo: el.tipoPredefinido.trim().toUpperCase() }]);

      const variantes = variantesClase(el.claseIfc);
      const entidad: ElementoXml = {
        nombre: "ids:entity",
        hijos: [
          variantes.length > 1 ? patron("ids:name", variantes.join("|")) : valorSimple("ids:name", variantes[0]),
          el.tipoPredefinido.trim() ? valorSimple("ids:predefinedType", el.tipoPredefinido.trim().toUpperCase()) : null,
        ],
      };
      const descripcion = [
        celda.lod !== null ? `LOD ${celda.lod}` : "",
        `NDI-${celda.ndi}`,
        celda.propositos.length ? `Propósito: ${celda.propositos.join(", ")}` : "",
        celda.actor.trim() ? `Entrega: ${celda.actor.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      especificaciones.push({
        nombre: "ids:specification",
        atributos: { name: nombre, ifcVersion: d.versiones.join(" "), identifier: el.codigo, description: descripcion, instructions: recortar(el.notas, 1000) || undefined },
        hijos: [
          // minOccurs 0: a model may not have this element (each discipline checks its own model).
          { nombre: "ids:applicability", atributos: { minOccurs: "0", maxOccurs: "unbounded" }, hijos: [entidad] },
          { nombre: "ids:requirements", hijos: facets },
        ],
      });
    }
  }
  if (especificaciones.length === 0) {
    throw new Error(
      omitidos.length
        ? `Ningún elemento de esta etapa se puede exportar: ${omitidos.map((o) => `${o.elemento} (${o.motivo})`).join("; ")}.`
        : "Ningún elemento de las disciplinas elegidas pide información (NDI) en esta etapa."
    );
  }

  const compartidas: string[][] = [];
  for (const lista of porClase.values()) {
    if (lista.length < 2) continue;
    const tipos = lista.map((x) => x.tipo);
    if (tipos.some((t) => !t) || new Set(tipos).size < tipos.length) compartidas.push(lista.map((x) => x.nombre));
  }

  const hito = `${d.etapa.nombre}${d.etapa.fecha ? ` (${d.etapa.fecha.split("-").reverse().join("-")})` : ""}`;
  const xml = escribirXml({
    nombre: "ids:ids",
    atributos: {
      "xmlns:ids": NS_IDS,
      "xmlns:xs": "http://www.w3.org/2001/XMLSchema",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xsi:schemaLocation": `${NS_IDS} ${ESQUEMA_IDS}`,
    },
    hijos: [
      {
        nombre: "ids:info",
        hijos: [
          { nombre: "ids:title", texto: `Requisitos BIM (LOIN) · ${d.proyecto} · ${d.etapa.nombre}` },
          { nombre: "ids:version", texto: d.fecha },
          { nombre: "ids:description", texto: "Requisitos de información por elemento (nivel de información necesaria, ISO 7817-1) generados por la extensión Requisitos BIM (LOIN) para Trimble Connect." },
          { nombre: "ids:date", texto: d.fecha },
          propositos.size ? { nombre: "ids:purpose", texto: [...propositos].join(", ") } : null,
          { nombre: "ids:milestone", texto: hito },
        ],
      },
      { nombre: "ids:specifications", hijos: especificaciones },
    ],
  });

  return {
    xml,
    especificaciones: especificaciones.length,
    requisitos,
    omitidos,
    compartidas,
    avisos: [...avisosPorTexto].map(([t, els]) => (els.size > 1 ? `${t} (en ${els.size} elementos)` : t)),
    sinExigencia,
  };
}

/** "Requisitos LOIN 21-10-2026 - Torre Norte - Construcción.ids" */
export const nombreArchivoIds = (proyecto: string, etapa: string, fecha: string) =>
  `${nombreSeguro(`Requisitos LOIN ${fecha.split("-").reverse().join("-")} - ${proyecto} - ${etapa}`, 120)}.ids`;

/** Builds the IDS and downloads it (browser only). */
export function descargarIds(d: DatosIds): ResultadoIds {
  const r = generarIds(d);
  descargar(new Blob([r.xml], { type: "application/xml" }), nombreArchivoIds(d.proyecto, d.etapa.nombre, d.fecha));
  return r;
}
