import { MotivoRechazo } from "./accesos";
import { CambioNivel, CambioNodo, EstadoNodo, FuenteNivel, Nivel, Nodo, RESERVADAS } from "./types";

/**
 * The structure of the work (doc §4.1, §5): the company's template of levels
 * (torre, etapa, zona, nivel, frente, disciplina…) that each project inherits
 * and may change, and the values of each level with who answers for them.
 * Capítulo, actividad and paquete de trabajo come from Presupuesto and are
 * never stored here.
 */

const CLAVE = /^[a-z][a-z0-9_]{1,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FUENTES: FuenteNivel[] = ["modelo", "propiedad", "manual"];
const ESTADOS: EstadoNodo[] = ["activo", "cerrado", "inactivo"];

/** The levels in force in a project: the template's, replaced by the project's own of the same key; active ones, in order. */
export function nivelesEfectivos(plantilla: Nivel[], propios: Nivel[]): (Nivel & { heredado: boolean })[] {
  const porClave = new Map<string, Nivel & { heredado: boolean }>();
  for (const n of plantilla) porClave.set(n.clave, { ...n, heredado: true });
  for (const n of propios) porClave.set(n.clave, { ...n, heredado: false });
  return [...porClave.values()].filter((n) => n.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

/** "Nivel" -> "nivel", "Nombre de zona" -> "nombre_de_zona": a key from a name. */
export function claveDe(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `n_${base}`.slice(0, 40);
}

/** Following the parents from `clave` reaches `clave` again. */
function hayCiclo(clave: string, padreDe: Map<string, string | null>): boolean {
  const vistos = new Set<string>();
  let actual: string | null | undefined = padreDe.get(clave);
  while (actual) {
    if (actual === clave || vistos.has(actual)) return true;
    vistos.add(actual);
    actual = padreDe.get(actual);
  }
  return false;
}

/**
 * Why this level can't be saved, or null. `mismoAlcance`: the levels of the same
 * scope (template or this project); `efectivos`: those in force where it applies.
 */
export function revisarNivel(cambio: CambioNivel, mismoAlcance: Nivel[], efectivos: Nivel[]): MotivoRechazo | null {
  if (!CLAVE.test(cambio.clave) || RESERVADAS.includes(cambio.clave)) return "datos";
  const nombre = cambio.nombre.trim();
  if (!nombre || nombre.length > 60) return "datos";
  if (!Number.isInteger(cambio.orden) || cambio.orden < 0 || cambio.orden > 999) return "datos";
  if (!FUENTES.includes(cambio.fuente)) return "datos";
  if (cambio.fuente === "manual" ? cambio.claveFuente !== "" : !cambio.claveFuente.trim() || cambio.claveFuente.length > 200) return "datos";
  const antes = cambio.id ? mismoAlcance.find((n) => n.id === cambio.id) : undefined;
  if (cambio.id && !antes) return "no-existe";
  if (antes && antes.clave !== cambio.clave) return "datos";
  if (mismoAlcance.some((n) => n.id !== cambio.id && n.clave === cambio.clave)) return "clave-repetida";
  if (cambio.padreClave !== null) {
    if (cambio.padreClave === cambio.clave) return "padre-no-valido";
    if (!efectivos.some((n) => n.clave === cambio.padreClave && n.activo)) return "padre-no-valido";
    const padreDe = new Map(efectivos.map((n) => [n.clave, n.padreClave]));
    padreDe.set(cambio.clave, cambio.padreClave);
    if (hayCiclo(cambio.clave, padreDe)) return "padre-no-valido";
  }
  if (antes) {
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";
  return null;
}

/** Why this value of a level can't be saved, or null. */
export function revisarNodo(cambio: CambioNodo, efectivos: Nivel[], nodos: Nodo[]): MotivoRechazo | null {
  const nivel = efectivos.find((n) => n.clave === cambio.nivelClave && n.activo);
  if (!nivel) return "nivel-no-valido";
  const valor = cambio.valor.trim();
  if (!valor || valor.length > 120) return "datos";
  if (!ESTADOS.includes(cambio.estado) || cambio.nota.length > 500 || cambio.responsableNombre.length > 200) return "datos";
  if ((cambio.inicio !== null && !ISO.test(cambio.inicio)) || (cambio.fin !== null && !ISO.test(cambio.fin))) return "datos";
  if (cambio.inicio && cambio.fin && cambio.fin < cambio.inicio) return "datos";
  if ((cambio.responsableId === null) !== (cambio.responsableNombre.trim() === "")) return "datos";
  const antes = cambio.id ? nodos.find((n) => n.id === cambio.id) : undefined;
  if (cambio.id && !antes) return "no-existe";
  if (antes && antes.nivelClave !== cambio.nivelClave) return "datos";
  // Unique inside the value above it: Piso 2 of Torre 1 and Piso 2 of Torre 2 are different places.
  const v = valor.toLowerCase();
  if (nodos.some((n) => n.id !== cambio.id && n.nivelClave === cambio.nivelClave && n.padreId === cambio.padreId && n.valor.trim().toLowerCase() === v)) return "valor-repetido";
  if (cambio.padreId !== null) {
    const padre = nodos.find((n) => n.id === cambio.padreId);
    if (!padre || nivel.padreClave === null || padre.nivelClave !== nivel.padreClave) return "padre-no-valido";
  }
  if (antes) {
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";
  return null;
}

/** The values of each level, with their parent's value, for the screen ("Torre 1 › Piso 5"). */
export function rutaNodo(nodo: Nodo, nodos: Nodo[]): string {
  const partes = [nodo.valor];
  const vistos = new Set([nodo.id]);
  let padre = nodo.padreId ? nodos.find((n) => n.id === nodo.padreId) : undefined;
  while (padre && !vistos.has(padre.id)) {
    partes.unshift(padre.valor);
    vistos.add(padre.id);
    padre = padre.padreId ? nodos.find((n) => n.id === padre!.padreId) : undefined;
  }
  return partes.join(" › ");
}

export const FUENTES_NIVEL: Record<FuenteNivel, { texto: string; ayuda: string }> = {
  modelo: { texto: "Propiedad del modelo", ayuda: "El valor se lee del modelo 3D (solo lectura) al leer cada versión." },
  propiedad: { texto: "Atributo de Propiedades", ayuda: "El valor se lee del atributo asignado en la extensión Propiedades, por IFCGUID." },
  manual: { texto: "Asignación a mano", ayuda: "Se asigna a cada elemento en Control de Obra; reasignar pregunta antes." },
};

export const ESTADOS_NODO: Record<EstadoNodo, { texto: string; color: string; fondo: string }> = {
  activo: { texto: "Activo", color: "#2e6b22", fondo: "#e3f3de" },
  cerrado: { texto: "Cerrado", color: "#6b7684", fondo: "#eef1f4" },
  inactivo: { texto: "Inactivo", color: "#b3261e", fondo: "#fbe4e2" },
};
