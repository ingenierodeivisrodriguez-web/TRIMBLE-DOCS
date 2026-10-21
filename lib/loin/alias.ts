// Where a parameter is read from in a model ("equivalencias de lectura"):
// "Pset_WallCommon.LoadBearing", "Datos de identidad.Capacidad de carga",
// "*.Capacidad de carga" (any group), "Qto_*BaseQuantities.NetVolume" or
// "@Name" (an IFC attribute). Names compare without case or accents, so a
// model with "Codigo de proyecto" matches the catalog's "Código de proyecto".
import { plegar } from "../presupuesto/format";
import type { Alias } from "./types";

const SUGERIDA = /\s*\((sugerida|sugerido)\)\s*$/i;

/** One alias from its text; only the first dot separates the group from the property ("Mat. Profesional" stays whole). */
export function leerAlias(texto: string, sugerida = false): Alias | null {
  let t = texto.trim();
  if (SUGERIDA.test(t)) {
    sugerida = true;
    t = t.replace(SUGERIDA, "");
  }
  if (!t) return null;
  if (t.startsWith("@")) {
    const propiedad = t.slice(1).trim();
    return propiedad ? { grupo: "@", propiedad, sugerida } : null;
  }
  const i = t.indexOf(".");
  if (i <= 0) return null;
  const grupo = t.slice(0, i).trim();
  const propiedad = t.slice(i + 1).trim();
  if (!grupo || !propiedad) return null;
  return { grupo, propiedad, sugerida };
}

export function textoAlias(a: Pick<Alias, "grupo" | "propiedad">): string {
  return a.grupo === "@" ? `@${a.propiedad}` : `${a.grupo}.${a.propiedad}`;
}

/** "A.B; *.C (sugerida)" as written in the Excel cell. */
export function textoListaAlias(alias: Alias[]): string {
  return alias.map((a) => `${textoAlias(a)}${a.sugerida ? " (sugerida)" : ""}`).join("; ");
}

/** The aliases of an Excel cell (separated by ";" or line breaks), and the pieces that aren't aliases. */
export function leerListaAlias(texto: string): { alias: Alias[]; errores: string[] } {
  const alias: Alias[] = [];
  const errores: string[] = [];
  for (const parte of texto.split(/[;\n]+/)) {
    if (!parte.trim()) continue;
    const a = leerAlias(parte);
    if (a) alias.push(a);
    else errores.push(parte.trim());
  }
  return { alias: sinRepetidos(alias), errores };
}

/** Same group and property (case and accents aside): the first one wins. */
export function sinRepetidos(alias: Alias[]): Alias[] {
  const vistos = new Set<string>();
  return alias.filter((a) => {
    const clave = `${plegar(a.grupo)}|${plegar(a.propiedad)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/** Lower case, no accents, single spaces. */
export function normalizarNombre(nombre: string): string {
  return plegar(nombre).replace(/\s+/g, " ").trim();
}

const patrones = new Map<string, RegExp>();

/** Whether a group name matches an alias group; "*" stands for any run of characters. */
export function coincideGrupo(patron: string, grupo: string): boolean {
  const p = normalizarNombre(patron);
  if (p === "*") return true;
  if (!p.includes("*")) return p === normalizarNombre(grupo);
  let re = patrones.get(p);
  if (!re) {
    re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    patrones.set(p, re);
  }
  return re.test(normalizarNombre(grupo));
}

/** The properties of one object as read from the viewer (groups) plus its IFC attributes. */
export interface PropiedadesObjeto {
  grupos: { nombre: string; propiedades: { nombre: string; valor: unknown }[] }[];
  /** "Name", "Description", "ObjectType"… */
  atributos: Record<string, unknown>;
}

export interface Hallazgo {
  valor: unknown;
  /** "Grupo.Propiedad" where it was found. */
  ruta: string;
  alias: Alias;
}

/**
 * The value of a parameter in an object: the first alias (in order of
 * preference) that the object has. A property that exists but is empty still
 * counts as found (the content check decides), unless a later alias has a value.
 */
export function buscarValor(objeto: PropiedadesObjeto, alias: Alias[]): Hallazgo | null {
  let vacio: Hallazgo | null = null;
  for (const a of alias) {
    const encontrados: Hallazgo[] = [];
    if (a.grupo === "@") {
      const nombre = normalizarNombre(a.propiedad);
      for (const [k, v] of Object.entries(objeto.atributos)) {
        if (normalizarNombre(k) === nombre) encontrados.push({ valor: v, ruta: `@${k}`, alias: a });
      }
    } else {
      const nombre = normalizarNombre(a.propiedad);
      for (const g of objeto.grupos) {
        if (!coincideGrupo(a.grupo, g.nombre)) continue;
        for (const p of g.propiedades) {
          if (normalizarNombre(p.nombre) === nombre) encontrados.push({ valor: p.valor, ruta: `${g.nombre}.${p.nombre}`, alias: a });
        }
      }
    }
    const conValor = encontrados.find((h) => !estaVacio(h.valor));
    if (conValor) return conValor;
    vacio ??= encontrados[0] ?? null;
  }
  return vacio;
}

export function estaVacio(valor: unknown): boolean {
  return valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "");
}
