// Checking one value against what a parameter requires: not empty, not a
// "garbage" value (only for text: a 0 is a valid number, e.g. a 0° slope),
// of the right type, within its bounds, in its list, matching its pattern.
import { parseNumberInput } from "../propiedades/values";
import { estaVacio, normalizarNombre } from "./alias";
import type { ReglaValor, TipoDato } from "./types";

/** Values that, in a text parameter, mean nobody filled it in. Editable per project. */
export const VALORES_BASURA_INICIALES = ["0", "-", "--", ".", "?", "N/A", "NA", "Default", "Predeterminado", "Por definir", "Sin definir", "TBD", "xx", "xxx"];

export type MotivoValor = "vacio" | "basura" | "tipo" | "rango" | "lista" | "patron";

export const MOTIVOS: Record<MotivoValor, string> = {
  vacio: "Vacío",
  basura: "Valor de relleno",
  tipo: "Tipo de dato incorrecto",
  rango: "Fuera de rango",
  lista: "No está en la lista",
  patron: "No cumple el patrón",
};

export type RevisionValor = { ok: true; valor: string | number | boolean } | { ok: false; motivo: MotivoValor; detalle: string };

export interface Requisito {
  tipoDato: TipoDato;
  valoresPermitidos: string[];
  unidad: string;
}

// ".T." / ".F." are how IFC files write booleans.
const VERDADERO = ["true", "verdadero", "si", "yes", "1", "t", "v", "s", "x"];
const FALSO = ["false", "falso", "no", "0", "f", "n"];

/** true / false from the usual ways models write them (TRUE, Verdadero, Sí, 1…); null otherwise. */
export function leerBooleano(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor === 1 ? true : valor === 0 ? false : null;
  if (typeof valor !== "string") return null;
  const t = normalizarNombre(valor).replace(/^\.|\.$/g, "");
  if (VERDADERO.includes(t)) return true;
  if (FALSO.includes(t)) return false;
  return null;
}

/** A number, also from text with a decimal comma or a unit after it ("0,15", "250 mm"); null otherwise. */
export function leerNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;
  const m = /^\s*([-+]?[\d.,]+)\s*[A-Za-z°²³%/]*\s*$/.exec(valor);
  return m ? parseNumberInput(m[1]) : null;
}

/** "DD-MM-AAAA", "DD/MM/AAAA" or "AAAA-MM-DD…" -> "AAAA-MM-DD"; null when it isn't a real date. */
export function leerFecha(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (r) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const fecha = new Date(Date.UTC(y, m - 1, d));
  if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Why a pattern can't be used, or null when it compiles. */
export function errorPatron(patron: string): string | null {
  if (!patron.trim()) return null;
  try {
    new RegExp(`^(?:${patron})$`, "u");
    return null;
  } catch (err) {
    return `El patrón no es una expresión regular válida (${err instanceof Error ? err.message : "error"}).`;
  }
}

const compilados = new Map<string, RegExp | null>();
function patronDe(patron: string): RegExp | null {
  if (!compilados.has(patron)) compilados.set(patron, errorPatron(patron) ? null : new RegExp(`^(?:${patron})$`, "u"));
  return compilados.get(patron) ?? null;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : String(v));

/** Checks a value; `basura` are the project's garbage values. */
export function revisarValor(req: Requisito, regla: ReglaValor, valor: unknown, basura: string[]): RevisionValor {
  if (estaVacio(valor)) return { ok: false, motivo: "vacio", detalle: "El parámetro está vacío." };

  if (req.tipoDato === "numero") {
    const n = leerNumero(valor);
    if (n === null) return { ok: false, motivo: "tipo", detalle: `"${texto(valor)}" no es un número.` };
    const u = req.unidad ? ` ${req.unidad}` : "";
    if (regla.min !== null && n < regla.min) return { ok: false, motivo: "rango", detalle: `${n}${u} es menor que el mínimo ${regla.min}${u}.` };
    if (regla.max !== null && n > regla.max) return { ok: false, motivo: "rango", detalle: `${n}${u} es mayor que el máximo ${regla.max}${u}.` };
    return { ok: true, valor: n };
  }
  if (req.tipoDato === "booleano") {
    const b = leerBooleano(valor);
    return b === null ? { ok: false, motivo: "tipo", detalle: `"${texto(valor)}" no es verdadero ni falso.` } : { ok: true, valor: b };
  }
  if (req.tipoDato === "fecha") {
    const f = leerFecha(valor);
    return f === null ? { ok: false, motivo: "tipo", detalle: `"${texto(valor)}" no es una fecha (DD-MM-AAAA).` } : { ok: true, valor: f };
  }

  const t = texto(valor);
  const plegado = normalizarNombre(t);
  if (basura.some((b) => normalizarNombre(b) === plegado)) return { ok: false, motivo: "basura", detalle: `"${t}" es un valor de relleno.` };
  if (req.tipoDato === "lista" && req.valoresPermitidos.length > 0 && !req.valoresPermitidos.some((v) => normalizarNombre(v) === plegado)) {
    return { ok: false, motivo: "lista", detalle: `"${t}" no es uno de los valores permitidos.` };
  }
  if (regla.patron) {
    const re = patronDe(regla.patron);
    if (re && !re.test(t)) return { ok: false, motivo: "patron", detalle: `"${t}" no cumple el patrón ${regla.patron}.` };
  }
  return { ok: true, valor: t };
}
