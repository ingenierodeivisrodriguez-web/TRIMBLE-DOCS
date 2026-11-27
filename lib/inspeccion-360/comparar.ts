// Pure rules of the before/after comparison of two 360° photos of the same point: which dates can
// be compared, the starting pair, the dividing bar and the per-photo turn that lines up photos
// taken with the camera facing another way.

import { fmtFechaHora } from "./fechas";
import { type CapturaVista, MAX_MINIATURA } from "./types";

/** Captures with a photo already in the CDE that were not voided, newest first. */
export function capturasComparables(capturas: readonly CapturaVista[]): CapturaVista[] {
  return capturas
    .filter((c) => c.estado !== "anulada" && c.estado !== "subiendo" && c.foto?.estado === "en_cde")
    .sort((a, b) => Date.parse(b.tomadaEn) - Date.parse(a.tomadaEn));
}

export interface Pareja {
  antesId: string;
  despuesId: string;
}

/** The two newest comparable dates: the newest is "después", the one before it is "antes". */
export function parejaInicial(capturas: readonly CapturaVista[]): Pareja | null {
  const lista = capturasComparables(capturas);
  return lista.length < 2 ? null : { antesId: lista[1].id, despuesId: lista[0].id };
}

/** Whether `c` can be the "antes" photo (`lado` = "antes") or the "después" photo of the pair. */
export function puedeSer<T extends { id: string; tomadaEn: string }>(lado: "antes" | "despues", c: T, pareja: Pareja, capturas: readonly T[]): boolean {
  const otra = capturas.find((x) => x.id === (lado === "antes" ? pareja.despuesId : pareja.antesId));
  if (!otra || otra.id === c.id) return false;
  const t = Date.parse(c.tomadaEn);
  const o = Date.parse(otra.tomadaEn);
  return lado === "antes" ? t <= o : t >= o;
}

/** A date the full screen tab can switch to (the tab has no session: the panel sends the list). */
export interface OpcionFecha {
  id: string;
  /** DD-MM-AAAA HH:MM */
  fecha: string;
  tomadaEn: string;
  inspector: string;
  /** The photo's small JPEG (data URL), or "". */
  miniatura: string;
  anulada: boolean;
}

const MINIATURA = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/**
 * The dates offered in full screen: the comparable ones plus `enPantalla` (the photos on screen,
 * even a voided one opened from the list), newest first.
 */
export function opcionesFecha(capturas: readonly CapturaVista[], enPantalla: readonly string[] = []): OpcionFecha[] {
  const lista = capturasComparables(capturas);
  for (const id of enPantalla) {
    const c = capturas.find((x) => x.id === id);
    if (c && !lista.includes(c) && c.foto?.estado === "en_cde") lista.push(c);
  }
  return lista
    .sort((a, b) => Date.parse(b.tomadaEn) - Date.parse(a.tomadaEn))
    .map((c) => ({ id: c.id, fecha: fmtFechaHora(c.tomadaEn), tomadaEn: c.tomadaEn, inspector: c.inspectorNombre, miniatura: c.foto?.miniatura ?? "", anulada: c.estado === "anulada" }));
}

/** The list the tab received from the panel, checked: anything malformed is dropped. */
export function opcionesFechaDe(v: unknown): OpcionFecha[] {
  if (!Array.isArray(v)) return [];
  const texto = (x: unknown) => typeof x === "string";
  return v
    .filter((o) => !!o && texto(o.id) && texto(o.fecha) && texto(o.tomadaEn) && Number.isFinite(Date.parse(o.tomadaEn)))
    .map((o) => ({
      id: o.id,
      fecha: o.fecha,
      tomadaEn: o.tomadaEn,
      inspector: texto(o.inspector) ? o.inspector : "",
      miniatura: texto(o.miniatura) && o.miniatura.length <= MAX_MINIATURA && MINIATURA.test(o.miniatura) ? o.miniatura : "",
      anulada: o.anulada === true,
    }));
}

/** Why a date cannot take that side of the pair (null when it can, or it is already there). */
export function motivoFechaNo(lado: "antes" | "despues", o: OpcionFecha, pareja: Pareja, opciones: readonly OpcionFecha[]): string | null {
  if (o.id === (lado === "antes" ? pareja.antesId : pareja.despuesId)) return null;
  if (o.id === (lado === "antes" ? pareja.despuesId : pareja.antesId)) return lado === "antes" ? "Es la foto «después»" : "Es la foto «antes»";
  if (puedeSer(lado, o, pareja, opciones)) return null;
  return lado === "antes" ? "Es posterior a la foto «después»" : "Es anterior a la foto «antes»";
}

/** Position of the bar (0–100 % of the width) from the pointer. */
export function divisionDesdePuntero(clientX: number, izquierda: number, ancho: number): number {
  if (!(ancho > 0)) return 50;
  return Math.min(100, Math.max(0, ((clientX - izquierda) / ancho) * 100));
}

/** The bar moved with the keyboard: arrows 2 % (10 % with Shift), Home / End to the edges. Null for other keys. */
export function divisionConTecla(valor: number, tecla: string, grande: boolean): number | null {
  const paso = grande ? 10 : 2;
  const v =
    tecla === "ArrowLeft" ? valor - paso
    : tecla === "ArrowRight" ? valor + paso
    : tecla === "Home" ? 0
    : tecla === "End" ? 100
    : null;
  return v === null ? null : Math.min(100, Math.max(0, v));
}

/** A turn in degrees brought to (−180, 180], rounded to a tenth. */
export function normalizarGiro(grados: number): number {
  if (!Number.isFinite(grados)) return 0;
  let g = grados % 360;
  if (g > 180) g -= 360;
  if (g <= -180) g += 360;
  const r = Math.round(g * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

export function giroEnRadianes(grados: number): number {
  return (normalizarGiro(grados) * Math.PI) / 180;
}

/**
 * Where the first version (26-11-2026) kept a photo's turn in the browser. The turn now lives in
 * the database for everyone; a turn still found here is offered to an editor to save.
 */
export function claveGiro(capturaId: string): string {
  return `i360-giro:${capturaId}`;
}

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenNavegador(): Almacen | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The turn this browser kept for the photo of a capture (0 when there is none or storage is blocked). */
export function leerGiroLocal(capturaId: string, almacen: Almacen | null = almacenNavegador()): number {
  try {
    const v = almacen?.getItem(claveGiro(capturaId));
    return v === null || v === undefined ? 0 : normalizarGiro(Number(v));
  } catch {
    return 0;
  }
}

/** Forgets the browser's turn (once saved in the database, or discarded). */
export function borrarGiroLocal(capturaId: string, almacen: Almacen | null = almacenNavegador()): void {
  try {
    almacen?.removeItem(claveGiro(capturaId));
  } catch {
    // Storage blocked: nothing to forget.
  }
}

/** The turn a photo starts with: the saved one; while nothing is saved, an editor gets the browser's old one to save. */
export function giroInicial(guardado: number, local: number, puedeAlinear: boolean): number {
  return guardado === 0 && puedeAlinear ? local : guardado;
}
