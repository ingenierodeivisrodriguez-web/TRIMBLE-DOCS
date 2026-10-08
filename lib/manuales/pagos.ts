// Online purchase of licenses with Mercado Pago: the administrator opens
// sales and sets the plans (months and price); a person without access (or
// renewing) picks one and pays in Mercado Pago's checkout; when the payment
// is approved, their license is created or extended by those months, without
// the administrator doing anything. Payments are confirmed by asking
// Mercado Pago itself (notification, the buyer's return, the screen waiting
// for it, and a daily check), so a forged notice can't open the manuals.
import { randomBytes } from "node:crypto";
import { MAX_MESES, periodoComprado } from "./licencia";
import type { Mp, PagoMp } from "./mercadopago";
import { ManualesError } from "./service";
import { etiquetaMeses, textoEstadoMp } from "./textos";
import type { Autorizado, ConfigVenta, ManualesStore, ResultadoAplicar } from "./store";
import type { CompraIniciada, EstadoCompra, Orden, Plan, VentaPublica } from "./types";

export const MONEDA = "COP";
const PRECIO_MAX = 100_000_000;
/** Purchases started per person per hour (each one creates a checkout in Mercado Pago). */
const MAX_COMPRAS_HORA = 10;
const ORDEN_RE = /^man_[A-Za-z0-9_-]{16}$/;

export function esOrden(id: unknown): id is string {
  return typeof id === "string" && ORDEN_RE.test(id);
}

/** The sales settings an administrator saves: `{ habilitada, planes: [{ meses, precio }] }`. */
export function leerVenta(body: unknown): { habilitada: boolean; planes: Plan[] } {
  const o = (body ?? {}) as { habilitada?: unknown; planes?: unknown };
  if (typeof o.habilitada !== "boolean") throw new ManualesError("Indica si la venta en línea está abierta.", 400, "parametro");
  if (!Array.isArray(o.planes) || o.planes.length > MAX_MESES) throw new ManualesError(`Indica de 1 a ${MAX_MESES} planes.`, 400, "parametro");
  const planes: Plan[] = [];
  for (const p of o.planes as { meses?: unknown; precio?: unknown }[]) {
    const meses = p?.meses;
    const precio = p?.precio;
    if (!Number.isInteger(meses) || (meses as number) < 1 || (meses as number) > MAX_MESES) {
      throw new ManualesError(`Cada plan debe ser de 1 a ${MAX_MESES} meses.`, 400, "parametro");
    }
    if (!Number.isInteger(precio) || (precio as number) < 1 || (precio as number) > PRECIO_MAX) {
      throw new ManualesError(`El precio del plan de ${etiquetaMeses(meses as number)} debe ser un valor en pesos, sin decimales.`, 400, "parametro");
    }
    if (planes.some((x) => x.meses === meses)) throw new ManualesError(`Hay dos planes de ${etiquetaMeses(meses as number)}.`, 400, "parametro");
    planes.push({ meses: meses as number, precio: precio as number });
  }
  if (o.habilitada && !planes.length) throw new ManualesError("Agrega al menos un plan para abrir la venta en línea.", 400, "parametro");
  return { habilitada: o.habilitada, planes: planes.sort((a, b) => a.meses - b.meses) };
}

export type MotivoSinCompra = "sin-mercadopago" | "venta-cerrada" | "sin-correo" | "suspendida" | "sin-vencimiento";

const MENSAJES: Record<MotivoSinCompra, string> = {
  "sin-mercadopago": "La compra en línea no está configurada (faltan las credenciales de Mercado Pago).",
  "venta-cerrada": "La compra en línea de licencias no está disponible.",
  "sin-correo": "Tu usuario de Trimble Connect no tiene correo: la licencia se asigna a tu correo.",
  suspendida: "Tu acceso está suspendido: pide al administrador que lo reactive antes de comprar.",
  "sin-vencimiento": "Tu acceso no vence: no necesitas comprar una licencia.",
};

/** Why this person can't buy a license now (null: they can). */
export function motivoSinCompra(venta: ConfigVenta, conMercadoPago: boolean, email: string, autorizado: Autorizado | null): MotivoSinCompra | null {
  if (!conMercadoPago) return "sin-mercadopago";
  if (!venta.habilitada || !venta.planes.length) return "venta-cerrada";
  if (!email) return "sin-correo";
  if (autorizado?.suspendido) return "suspendida";
  if (autorizado && autorizado.vence === null) return "sin-vencimiento";
  return null;
}

/** What the person sees on sale, or null when they can't buy. */
export function ventaPublica(venta: ConfigVenta, mp: { prueba: boolean } | null, email: string, autorizado: Autorizado | null): VentaPublica | null {
  if (motivoSinCompra(venta, !!mp, email, autorizado)) return null;
  return { planes: venta.planes, moneda: MONEDA, prueba: !!mp?.prueba };
}

export interface Comprador {
  email: string;
  nombre: string;
}

export interface UrlsPago {
  /** The page the buyer returns to from Mercado Pago. */
  retorno: string;
  /** Where Mercado Pago notifies the payment (null when this app isn't public, e.g. on localhost). */
  notificacion: string | null;
}

/**
 * Starts a purchase of `{ meses }`: the price comes from the administrator's
 * plans (never from the request), and the license goes to the caller's own
 * Trimble Connect e-mail.
 */
export async function iniciarCompra(store: ManualesStore, mp: Mp | null, comprador: Comprador, body: unknown, urls: UrlsPago, hoy: string, ahora = Date.now()): Promise<CompraIniciada> {
  const meses = (body as { meses?: unknown } | null)?.meses;
  if (!Number.isInteger(meses)) throw new ManualesError("Elige cuántos meses quieres comprar.", 400, "parametro");
  const email = comprador.email.toLowerCase();
  const [venta, autorizado] = await Promise.all([store.getVenta(), email ? store.getAutorizado(email) : Promise.resolve(null)]);
  const motivo = motivoSinCompra(venta, !!mp, email, autorizado);
  if (motivo) throw new ManualesError(MENSAJES[motivo], 409, motivo);
  const plan = venta.planes.find((p) => p.meses === meses);
  if (!plan) throw new ManualesError("Ese plan ya no está a la venta: vuelve a abrir Manuales para ver los planes actuales.", 409, "plan");
  const recientes = await store.listarOrdenes({ email, desde: new Date(ahora - 3600_000).toISOString(), limite: MAX_COMPRAS_HORA });
  if (recientes.length >= MAX_COMPRAS_HORA) throw new ManualesError("Iniciaste demasiadas compras seguidas. Inténtalo de nuevo en una hora.", 429, "demasiadas");

  const id = `man_${randomBytes(12).toString("base64url")}`;
  await store.crearOrden({ id, email, nombre: comprador.nombre, meses: plan.meses, monto: plan.precio, moneda: MONEDA });
  const pref = await mp!.crearPreferencia({
    referencia: id,
    titulo: `Licencia Manuales · ${etiquetaMeses(plan.meses)}`,
    descripcion: `Acceso de ${email} a los manuales en Trimble Connect`,
    monto: plan.precio,
    moneda: MONEDA,
    ...urls,
  });
  await store.marcarPreferencia(id, pref.id);
  return {
    orden: id,
    url: pref.url,
    meses: plan.meses,
    monto: plan.precio,
    moneda: MONEDA,
    vence: periodoComprado(autorizado ? autorizado.vence : undefined, plan.meses, hoy)?.vence ?? null,
  };
}

export type ResultadoPago = ResultadoAplicar["resultado"] | "ajeno";

function aplicar(store: ManualesStore, p: PagoMp, hoy: string): Promise<ResultadoAplicar> {
  return store.aplicarPago({ orden: p.referencia!, pagoId: p.id, estadoMp: p.estado, detalleMp: p.detalle, monto: p.monto, moneda: p.moneda, hoy });
}

/**
 * A payment Mercado Pago told us about (by notification or on the buyer's
 * return): read from Mercado Pago and applied to its purchase. "ajeno" when
 * it isn't a purchase of this app.
 */
export async function procesarPago(store: ManualesStore, mp: Mp, pagoId: string, hoy: string): Promise<{ resultado: ResultadoPago; orden?: string; vence?: string | null }> {
  const p = await mp.pago(pagoId);
  if (!p || !esOrden(p.referencia)) return { resultado: "ajeno" };
  const r = await aplicar(store, p, hoy);
  return { resultado: r.resultado === "no-existe" ? "ajeno" : r.resultado, orden: p.referencia, vence: r.vence };
}

/** A pending purchase checked against Mercado Pago (in case its notification didn't arrive). Returns it updated. */
export async function verificarOrden(store: ManualesStore, mp: Mp, orden: Orden, hoy: string): Promise<Orden> {
  if (orden.estado !== "pendiente") return orden;
  const pagos = await mp.buscarPagos(orden.id);
  const aprobado = pagos.find((p) => p.estado === "approved");
  const pago = aprobado ?? pagos[0];
  if (pago && (pago.estado !== orden.estadoMp || pago.detalle !== orden.detalleMp || aprobado)) await aplicar(store, { ...pago, referencia: orden.id }, hoy);
  return (await store.getOrden(orden.id)) ?? orden;
}

/** The daily check: purchases of the last days still pending are checked against Mercado Pago. */
export async function conciliarPendientes(store: ManualesStore, mp: Mp, hoy: string, ahora = Date.now()): Promise<{ revisadas: number; aprobadas: number }> {
  const pendientes = await store.listarOrdenes({ estado: "pendiente", desde: new Date(ahora - 3 * 86_400_000).toISOString(), limite: 50 });
  let aprobadas = 0;
  for (const o of pendientes) {
    const v = await verificarOrden(store, mp, o, hoy);
    if (v.estado !== "pendiente") aprobadas++;
  }
  return { revisadas: pendientes.length, aprobadas };
}

/** The purchase as its buyer sees it. */
export function estadoCompra(o: Orden): EstadoCompra {
  return {
    orden: o.id,
    estado: o.estado,
    estadoMp: o.estadoMp,
    detalleMp: o.detalleMp,
    meses: o.meses,
    monto: o.monto,
    moneda: o.moneda,
    vence: o.venceNueva,
    texto: textoEstadoMp(o.estadoMp, o.detalleMp),
  };
}
