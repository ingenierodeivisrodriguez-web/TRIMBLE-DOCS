import type { EstadoProveedor } from "./types";

/** Suppliers: the DIAN check digit and how states read. */

const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** The NIT (or cédula) digits, without dots, dashes or the check digit. */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/** DIAN check digit (dígito de verificación) of a NIT of up to 15 digits. */
export function digitoVerificacion(nit: string): number {
  const d = soloDigitos(nit);
  let suma = 0;
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * PESOS[i];
  const r = suma % 11;
  return r > 1 ? 11 - r : r;
}

/** "890903938" -> "890.903.938-8". */
export function nitConDv(nit: string, dv = digitoVerificacion(nit)): string {
  const d = soloDigitos(nit);
  return `${d.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

/**
 * Reads what was typed: "890.903.938-8", "890903938 8" or "890903938".
 * With a check digit it must be the right one.
 */
export function leerNit(texto: string): { nit: string; dv: number } | { error: string } {
  const t = texto.trim();
  const m = /^([\d.\s]+?)(?:\s*-\s*|\s+)(\d)$/.exec(t);
  const nit = soloDigitos(m ? m[1] : t);
  if (nit.length < 5 || nit.length > 15) return { error: "El NIT debe tener entre 5 y 15 dígitos (sin el dígito de verificación)." };
  const dv = digitoVerificacion(nit);
  if (m && Number(m[2]) !== dv) return { error: `El dígito de verificación de ${nitConDv(nit, dv).replace(/-\d$/, "")} es ${dv}, no ${m[2]}.` };
  return { nit, dv };
}

export const ESTADOS_PROVEEDOR: Record<EstadoProveedor, { texto: string; color: string; fondo: string }> = {
  activo: { texto: "Activo", color: "#2e6b22", fondo: "#e3f3de" },
  inactivo: { texto: "Inactivo", color: "#6b7684", fondo: "#eef1f4" },
  bloqueado: { texto: "Bloqueado", color: "#b3261e", fondo: "#fbe4e2" },
};
