// Statements of the license sales for fiscal reviews and financial control:
// cash collected (approved payments) and refunds by the date they happened,
// and revenue recognized over each license's term (accrued in the period /
// deferred at its close), plus the reconciliation between them. Amounts are
// gross: the gateways' fees and withholdings are in their own statements.
// Dates are the company's days ("YYYY-MM-DD", Colombia by default).
import { diasEntre, hoyIso, sumarMeses } from "./licencia";
import type { IdPasarela } from "./pasarelas";
import type { Orden } from "./types";

export type TipoMovimiento = "venta" | "reembolso";

export interface Movimiento {
  fecha: string;
  tipo: TipoMovimiento;
  orden: string;
  email: string;
  nombre: string;
  meses: number;
  pasarela: IdPasarela;
  pagoId: string | null;
  /** Positive for a sale, negative for a refund. */
  valor: number;
  /** The license term the sale pays (last day included); null when the license doesn't expire. */
  desde: string | null;
  hasta: string | null;
}

export interface Fila {
  ventas: number;
  bruto: number;
  reembolsos: number;
  neto: number;
}

export interface FilaMes extends Fila {
  /** "2026-10" */
  mes: string;
  devengado: number;
  /** Still to accrue at the month's close. */
  diferido: number;
}

export interface EstadoDeCuenta {
  desde: string;
  hasta: string;
  /** Cash: approved payments in the period, refunds in the period, and the net. */
  ventas: number;
  bruto: number;
  reembolsosCantidad: number;
  reembolsos: number;
  neto: number;
  ticketPromedio: number;
  /** Revenue: deferred at the start, sales of the period that weren't refunded, accrued in the period, deferred at the close. */
  diferidoInicial: number;
  recaudoNoReembolsado: number;
  devengado: number;
  diferidoFinal: number;
  porPasarela: (Fila & { pasarela: IdPasarela })[];
  porPlan: (Fila & { meses: number })[];
  movimientos: Movimiento[];
  /** Payments that came in for less than the price: money received, no license (amount of the purchase). */
  porRevisar: Orden[];
}

export function fechaLocal(timestamp: string, zona = "America/Bogota"): string {
  return hoyIso(new Date(timestamp), zona);
}

/** The day before "YYYY-MM-DD". */
function diaAnterior(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** First and last day of a month ("2026-10") or a year ("2026"). */
export function rango(periodo: string): { desde: string; hasta: string } {
  if (/^\d{4}$/.test(periodo)) return { desde: `${periodo}-01-01`, hasta: `${periodo}-12-31` };
  const desde = `${periodo}-01`;
  return { desde, hasta: diaAnterior(sumarMeses(desde, 1)) };
}

/**
 * The days of service a sale pays: after the previous expiry when the
 * license was renewed while in force, otherwise from the payment's day; up
 * to the new expiry. Days are counted as (inicio, vence].
 */
function termino(o: Orden, fechaPago: string): { inicio: string; vence: string } | null {
  if (!o.venceNueva) return null;
  const inicio = o.venceAnterior && o.venceAnterior >= fechaPago ? o.venceAnterior : fechaPago;
  return { inicio, vence: o.venceNueva };
}

/** Days of (inicio, vence] that fall in [desde, hasta]. */
function diasEn(inicio: string, vence: string, desde: string, hasta: string): number {
  const a = inicio >= desde ? inicio : diaAnterior(desde);
  const b = vence <= hasta ? vence : hasta;
  return Math.max(0, diasEntre(a, b));
}

/** How much of a sale is recognized up to `hasta` (included). */
function devengadoHasta(o: Orden, fechaPago: string, hasta: string): number {
  if (fechaPago > hasta) return 0;
  const t = termino(o, fechaPago);
  if (!t) return o.monto; // no expiry: recognized when paid
  const total = Math.max(1, diasEntre(t.inicio, t.vence));
  if (hasta >= t.vence) return o.monto;
  return (o.monto * diasEn(t.inicio, t.vence, "0000-01-01", hasta)) / total;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function vacia(): Fila {
  return { ventas: 0, bruto: 0, reembolsos: 0, neto: 0 };
}

/** Sales and refunds, oldest first. */
export function movimientosDe(ordenes: Orden[], zona?: string): Movimiento[] {
  const out: Movimiento[] = [];
  for (const o of ordenes) {
    if (!o.pagada || (o.estado !== "aprobada" && o.estado !== "reembolsada")) continue;
    const fecha = fechaLocal(o.pagada, zona);
    const t = termino(o, fecha);
    const base = { orden: o.id, email: o.email, nombre: o.nombre, meses: o.meses, pasarela: o.pasarela, pagoId: o.pagoId, desde: t ? t.inicio : null, hasta: t ? t.vence : null };
    out.push({ ...base, fecha, tipo: "venta", valor: o.monto });
    if (o.estado === "reembolsada") out.push({ ...base, fecha: fechaLocal(o.actualizada, zona), tipo: "reembolso", valor: -o.monto });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? 0 : a.tipo === "venta" ? -1 : 1));
}

/**
 * The statement of [desde, hasta]. Refunded purchases count as cash in and
 * out, but never as revenue.
 */
export function estadoDeCuenta(ordenes: Orden[], desde: string, hasta: string, zona?: string): EstadoDeCuenta {
  const movimientos = movimientosDe(ordenes, zona).filter((m) => m.fecha >= desde && m.fecha <= hasta);
  const total = vacia();
  const porPasarela = new Map<IdPasarela, Fila>();
  const porPlan = new Map<number, Fila>();
  for (const m of movimientos) {
    const filas = [total, porPasarela.get(m.pasarela) ?? vacia(), porPlan.get(m.meses) ?? vacia()];
    porPasarela.set(m.pasarela, filas[1]);
    porPlan.set(m.meses, filas[2]);
    for (const f of filas) {
      if (m.tipo === "venta") {
        f.ventas++;
        f.bruto += m.valor;
      } else f.reembolsos -= m.valor;
      f.neto += m.valor;
    }
  }

  let diferidoInicial = 0;
  let recaudoNoReembolsado = 0;
  let devengado = 0;
  let diferidoFinal = 0;
  const anterior = diaAnterior(desde);
  for (const o of ordenes) {
    if (o.estado !== "aprobada" || !o.pagada) continue;
    const fecha = fechaLocal(o.pagada, zona);
    const hastaAntes = devengadoHasta(o, fecha, anterior);
    const hastaFin = devengadoHasta(o, fecha, hasta);
    if (fecha <= anterior) diferidoInicial += o.monto - hastaAntes;
    if (fecha >= desde && fecha <= hasta) recaudoNoReembolsado += o.monto;
    devengado += hastaFin - hastaAntes;
    if (fecha <= hasta) diferidoFinal += o.monto - hastaFin;
  }

  const reembolsosCantidad = movimientos.filter((m) => m.tipo === "reembolso").length;
  const porRevisar = ordenes
    .filter((o) => o.estado === "revisar" && o.pagada && fechaLocal(o.pagada, zona) >= desde && fechaLocal(o.pagada, zona) <= hasta)
    .sort((a, b) => (a.pagada ?? "").localeCompare(b.pagada ?? ""));
  return {
    desde,
    hasta,
    ventas: total.ventas,
    bruto: total.bruto,
    reembolsosCantidad,
    reembolsos: total.reembolsos,
    neto: total.neto,
    ticketPromedio: total.ventas ? redondear(total.bruto / total.ventas) : 0,
    diferidoInicial: redondear(diferidoInicial),
    recaudoNoReembolsado: redondear(recaudoNoReembolsado),
    devengado: redondear(devengado),
    diferidoFinal: redondear(diferidoFinal),
    porPasarela: [...porPasarela.entries()].map(([pasarela, f]) => ({ pasarela, ...f })).sort((a, b) => b.bruto - a.bruto),
    porPlan: [...porPlan.entries()].map(([meses, f]) => ({ meses, ...f })).sort((a, b) => a.meses - b.meses),
    movimientos,
    porRevisar,
  };
}

/** Month by month of a year, up to `hoy` when it is the current year. */
export function porMes(ordenes: Orden[], anio: number, hoy: string, zona?: string): FilaMes[] {
  const out: FilaMes[] = [];
  for (let m = 1; m <= 12; m++) {
    const mes = `${anio}-${String(m).padStart(2, "0")}`;
    if (`${mes}-01` > hoy) break;
    const { desde, hasta } = rango(mes);
    const e = estadoDeCuenta(ordenes, desde, hasta, zona);
    out.push({ mes, ventas: e.ventas, bruto: e.bruto, reembolsos: e.reembolsos, neto: e.neto, devengado: e.devengado, diferido: e.diferidoFinal });
  }
  return out;
}
