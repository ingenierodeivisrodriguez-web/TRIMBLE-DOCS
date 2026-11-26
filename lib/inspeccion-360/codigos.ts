// Capture point codes (PROYECTO-TORRE-PISO-UNIDAD-Cnn), CDE file names and folders (entregable 7).

export const CODIGO = /^([A-Z0-9]{2,6})-([A-Z0-9]{2,6})-([A-Z0-9]{2,6})-([A-Z0-9]{2,10})-C([0-9]{2})$/;
const PROYECTO = /^[A-Z0-9]{2,6}$/;
const TORRE_PISO = /^[A-Z0-9]{2,6}$/;
const UNIDAD = /^[A-Z0-9]{2,10}$/;

export interface PartesCodigo {
  proyecto: string;
  torre: string;
  piso: string;
  unidad: string;
  numero: number;
}

/** "Torre 1" → "TORRE1", "apt 501" → "APT501": capitals, no accents, spaces or dashes. */
export function normalizarSegmento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Why a part of the code is not valid ("" when it is). */
export function errorSegmento(parte: keyof PartesCodigo, valor: string | number): string {
  if (parte === "numero") return Number.isInteger(valor) && Number(valor) >= 1 && Number(valor) <= 99 ? "" : "El número del punto va de 1 a 99.";
  const v = String(valor);
  if (parte === "proyecto") return PROYECTO.test(v) ? "" : "El código del proyecto lleva de 2 a 6 letras o números (por ejemplo MAL).";
  if (parte === "unidad") return UNIDAD.test(v) ? "" : "La unidad lleva de 2 a 10 letras o números (APT501, LC03, PAS, ESC1…).";
  return TORRE_PISO.test(v) ? "" : `${parte === "torre" ? "La torre" : "El piso"} lleva de 2 a 6 letras o números (TR1, P05, S1, CUB…).`;
}

export function armarCodigo(p: PartesCodigo): string {
  for (const k of ["proyecto", "torre", "piso", "unidad", "numero"] as const) {
    const e = errorSegmento(k, p[k]);
    if (e) throw new Error(e);
  }
  return `${p.proyecto}-${p.torre}-${p.piso}-${p.unidad}-C${String(p.numero).padStart(2, "0")}`;
}

export function leerCodigo(codigo: string): PartesCodigo | null {
  const m = CODIGO.exec(codigo);
  if (!m || Number(m[5]) < 1) return null;
  return { proyecto: m[1], torre: m[2], piso: m[3], unidad: m[4], numero: Number(m[5]) };
}

/** The next point number of a unit: one more than the highest ever used (codes are never reused). */
export function siguienteNumero(puntos: { torre: string; piso: string; unidad: string; numero: number }[], torre: string, piso: string, unidad: string): number {
  let mayor = 0;
  for (const p of puntos) if (p.torre === torre && p.piso === piso && p.unidad === unidad && p.numero > mayor) mayor = p.numero;
  return mayor + 1;
}

/**
 * File name in the CDE: MAL-TR1-P05-APT501-C01_20261126-0930_360.jpg (date as AAAAMMDD-HHMM only
 * in the name, so the folder sorts by date; screens always show DD-MM-AAAA). `repetido` adds -2, -3…
 * when that point already has a photo at the same minute.
 */
export function nombreArchivo(codigo: string, local: { anio: number; mes: number; dia: number; hora: number; minuto: number }, repetido = 1): string {
  const d = (n: number, l = 2) => String(n).padStart(l, "0");
  const sufijo = repetido > 1 ? `-${repetido}` : "";
  return `${codigo}_${d(local.anio, 4)}${d(local.mes)}${d(local.dia)}-${d(local.hora)}${d(local.minuto)}_360${sufijo}.jpg`;
}

/** Folders of a point under the root folder: Inspección 360 / TR1 / P05 / APT501 / C01. */
export function rutaCarpetas(carpetaRaiz: string, p: { torre: string; piso: string; unidad: string; numero: number }): string[] {
  return [carpetaRaiz, p.torre, p.piso, p.unidad, `C${String(p.numero).padStart(2, "0")}`];
}
