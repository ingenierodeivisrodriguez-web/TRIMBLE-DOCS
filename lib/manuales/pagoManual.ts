// Payments an administrator registers by hand when authorizing or renewing
// someone (bank transfer, cash, Nequi...), or courtesies (no charge): they go
// into the statements like the gateways' payments, backing the license.
import { randomBytes } from "node:crypto";
import { diasEntre, esFecha, fechaVisible } from "./licencia";
import { ManualesError } from "./service";
import type { Autorizado, ManualesStore } from "./store";
import { MEDIOS_PAGO, MedioPago } from "./textos";

export interface PagoLeido {
  monto: number;
  medio: MedioPago | "cortesia";
  /** "YYYY-MM-DD" */
  fecha: string;
  referencia: string | null;
  soporte: string | null;
}

const PRECIO_MAX = 100_000_000;

function texto(v: unknown, max: number, campo: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > max) throw new ManualesError(`${campo}: máximo ${max} caracteres.`, 400, "parametro");
  return v.trim() || null;
}

/**
 * `{ tipo: "pago", valor, medio, fecha, referencia?, soporte? }` or
 * `{ tipo: "cortesia", fecha?, soporte? }` (a license given without charge).
 */
export function leerPago(body: unknown, hoy: string): PagoLeido {
  const o = (body ?? {}) as { tipo?: unknown; valor?: unknown; medio?: unknown; fecha?: unknown; referencia?: unknown; soporte?: unknown };
  const fecha = o.fecha === undefined || o.fecha === null || o.fecha === "" ? hoy : o.fecha;
  if (!esFecha(fecha)) throw new ManualesError("La fecha del pago no es válida.", 400, "parametro");
  if (fecha > hoy) throw new ManualesError("La fecha del pago no puede ser futura.", 400, "parametro");
  const soporte = texto(o.soporte, 300, "Soporte");
  if (o.tipo === "cortesia") return { monto: 0, medio: "cortesia", fecha, referencia: null, soporte };
  if (o.tipo !== "pago") throw new ManualesError("Indica si es un pago recibido o una cortesía.", 400, "parametro");
  if (!Number.isInteger(o.valor) || (o.valor as number) < 1 || (o.valor as number) > PRECIO_MAX) {
    throw new ManualesError("Escribe el valor pagado en pesos, sin decimales.", 400, "parametro");
  }
  if (typeof o.medio !== "string" || !(o.medio in MEDIOS_PAGO)) throw new ManualesError("Elige el medio de pago.", 400, "parametro");
  return { monto: o.valor as number, medio: o.medio as MedioPago, fecha, referencia: texto(o.referencia, 100, "Referencia"), soporte };
}

/** Months the license covers, for the purchase's "plan" (1 to 12). */
function mesesDe(a: Autorizado): number {
  if (a.licenciaMeses) return a.licenciaMeses;
  if (!a.inicio || !a.vence) return 12;
  return Math.min(12, Math.max(1, Math.round(diasEntre(a.inicio, a.vence) / 30.4)));
}

/** Registers a manual payment (or courtesy) backing the person's current license. */
export async function registrarPagoManual(store: ManualesStore, a: Autorizado, pago: PagoLeido, por: string): Promise<string> {
  const id = `man_${randomBytes(12).toString("base64url")}`;
  await store.registrarPagoManual({
    id,
    email: a.email,
    nombre: a.nombre,
    meses: mesesDe(a),
    monto: pago.monto,
    moneda: "COP",
    medio: pago.medio,
    referencia: pago.referencia,
    soporte: pago.soporte,
    registradoPor: por,
    // Midday in Colombia, so the day is the same whatever the time zone.
    pagada: new Date(`${pago.fecha}T12:00:00-05:00`).toISOString(),
    venceAnterior: a.vence ? a.inicio : null,
    venceNueva: a.vence,
  });
  return id;
}

/** `{ orden, motivo }`: annuls a manual payment; it stays in the statements as a reversal on today's date. */
export async function anularPago(store: ManualesStore, body: unknown, por: string, hoy: string): Promise<void> {
  const o = (body ?? {}) as { orden?: unknown; motivo?: unknown };
  const motivo = texto(o.motivo, 300, "Motivo");
  if (!motivo) throw new ManualesError("Escribe el motivo de la anulación.", 400, "parametro");
  if (typeof o.orden !== "string" || !(await store.anularPagoManual(o.orden, `Anulado el ${fechaVisible(hoy)} por ${por}: ${motivo}`))) {
    throw new ManualesError("Solo se pueden anular pagos manuales registrados y vigentes.", 409, "no-anulable");
  }
}
