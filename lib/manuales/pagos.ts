// Online purchase of licenses with Mercado Pago or Wompi (the buyer
// chooses): the administrator opens sales and sets the plans (months and
// price); a person without access (or renewing) picks one and pays in the
// gateway's checkout; when the payment is approved, their license is created
// or extended by those months, without the administrator doing anything.
// Payments are confirmed by asking the gateway itself (notification, the
// buyer's return, the screen waiting for it, and a daily check), so a forged
// notice can't open the manuals.
import { randomBytes } from "node:crypto";
import { MAX_MESES, periodoComprado } from "./licencia";
import { esPasarela, IdPasarela, NOMBRE_PASARELA, Pasarela, PagoPasarela, PASARELAS, Pasarelas } from "./pasarelas";
import { ManualesError } from "./service";
import { etiquetaMeses, textoEstadoPago } from "./textos";
import type { Autorizado, ConfigVenta, ManualesStore, ResultadoAplicar } from "./store";
import type { CompraIniciada, EstadoCompra, Orden, Plan, VentaPublica } from "./types";

export const MONEDA = "COP";
const PRECIO_MAX = 100_000_000;
/** Purchases started per person per hour (each one creates a checkout in the gateway). */
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

export type MotivoSinCompra = "sin-pasarela" | "venta-cerrada" | "sin-correo" | "suspendida" | "sin-vencimiento";

const MENSAJES: Record<MotivoSinCompra, string> = {
  "sin-pasarela": "La compra en línea no está configurada (faltan las credenciales de Mercado Pago o de Wompi).",
  "venta-cerrada": "La compra en línea de licencias no está disponible.",
  "sin-correo": "Tu usuario de Trimble Connect no tiene correo: la licencia se asigna a tu correo.",
  suspendida: "Tu acceso está suspendido: pide al administrador que lo reactive antes de comprar.",
  "sin-vencimiento": "Tu acceso no vence: no necesitas comprar una licencia.",
};

/** The gateways configured, in the order the buyer sees them. */
export function disponibles(pasarelas: Pasarelas): Pasarela[] {
  return PASARELAS.map((id) => pasarelas[id]).filter((p): p is Pasarela => !!p);
}

/** Why this person can't buy a license now (null: they can). */
export function motivoSinCompra(venta: ConfigVenta, hayPasarela: boolean, email: string, autorizado: Autorizado | null): MotivoSinCompra | null {
  if (!hayPasarela) return "sin-pasarela";
  if (!venta.habilitada || !venta.planes.length) return "venta-cerrada";
  if (!email) return "sin-correo";
  if (autorizado?.suspendido) return "suspendida";
  if (autorizado && autorizado.vence === null) return "sin-vencimiento";
  return null;
}

/** What the person sees on sale (and with which gateways), or null when they can't buy. */
export function ventaPublica(
  venta: ConfigVenta,
  pasarelas: { id: IdPasarela; prueba: boolean }[],
  email: string,
  autorizado: Autorizado | null
): VentaPublica | null {
  if (motivoSinCompra(venta, pasarelas.length > 0, email, autorizado)) return null;
  return { planes: venta.planes, moneda: MONEDA, pasarelas: pasarelas.map((p) => ({ id: p.id, nombre: NOMBRE_PASARELA[p.id], prueba: p.prueba })) };
}

export interface Comprador {
  email: string;
  nombre: string;
}

export interface UrlsPago {
  /** The page the buyer returns to from the gateway. */
  retorno: string;
  /** Where the gateway notifies the payment (null when it is set in the gateway's dashboard, or this app isn't public). */
  notificacion: string | null;
}

/**
 * Starts a purchase of `{ meses, pasarela? }` (the first gateway configured
 * by default): the price comes from the administrator's plans (never from
 * the request), and the license goes to the caller's own Trimble Connect e-mail.
 */
export async function iniciarCompra(
  store: ManualesStore,
  pasarelas: Pasarelas,
  comprador: Comprador,
  body: unknown,
  urls: (pasarela: IdPasarela) => UrlsPago,
  hoy: string,
  ahora = Date.now()
): Promise<CompraIniciada> {
  const o = (body ?? {}) as { meses?: unknown; pasarela?: unknown };
  if (!Number.isInteger(o.meses)) throw new ManualesError("Elige cuántos meses quieres comprar.", 400, "parametro");
  if (o.pasarela !== undefined && !esPasarela(o.pasarela)) throw new ManualesError("Medio de pago no válido.", 400, "parametro");
  const email = comprador.email.toLowerCase();
  const [venta, autorizado] = await Promise.all([store.getVenta(), email ? store.getAutorizado(email) : Promise.resolve(null)]);
  const motivo = motivoSinCompra(venta, disponibles(pasarelas).length > 0, email, autorizado);
  if (motivo) throw new ManualesError(MENSAJES[motivo], 409, motivo);
  const pasarela = o.pasarela ? pasarelas[o.pasarela] : disponibles(pasarelas)[0];
  if (!pasarela) throw new ManualesError(`${NOMBRE_PASARELA[o.pasarela as IdPasarela]} no está disponible: elige otro medio de pago.`, 409, "pasarela");
  const plan = venta.planes.find((p) => p.meses === o.meses);
  if (!plan) throw new ManualesError("Ese plan ya no está a la venta: vuelve a abrir Manuales para ver los planes actuales.", 409, "plan");
  const recientes = await store.listarOrdenes({ email, desde: new Date(ahora - 3600_000).toISOString(), limite: MAX_COMPRAS_HORA });
  if (recientes.length >= MAX_COMPRAS_HORA) throw new ManualesError("Iniciaste demasiadas compras seguidas. Inténtalo de nuevo en una hora.", 429, "demasiadas");

  const id = `man_${randomBytes(12).toString("base64url")}`;
  await store.crearOrden({ id, email, nombre: comprador.nombre, meses: plan.meses, monto: plan.precio, moneda: MONEDA, pasarela: pasarela.id });
  const cobro = await pasarela.crearCobro({
    referencia: id,
    titulo: `Licencia Manuales · ${etiquetaMeses(plan.meses)}`,
    descripcion: `Acceso de ${email} a los manuales en Trimble Connect`,
    monto: plan.precio,
    moneda: MONEDA,
    email,
    nombre: comprador.nombre,
    ...urls(pasarela.id),
  });
  if (cobro.id) await store.marcarPreferencia(id, cobro.id);
  return {
    orden: id,
    url: cobro.url,
    pasarela: pasarela.id,
    meses: plan.meses,
    monto: plan.precio,
    moneda: MONEDA,
    vence: periodoComprado(autorizado ? autorizado.vence : undefined, plan.meses, hoy)?.vence ?? null,
  };
}

export type ResultadoPago = ResultadoAplicar["resultado"] | "ajeno";

function aplicar(store: ManualesStore, orden: string, p: PagoPasarela, hoy: string): Promise<ResultadoAplicar> {
  return store.aplicarPago({ orden, pagoId: p.id, estadoPago: p.estado, detallePago: p.detalle, monto: p.monto, moneda: p.moneda, hoy });
}

/**
 * A payment a gateway told us about (by notification or on the buyer's
 * return): read from that gateway and applied to its purchase. "ajeno" when
 * it isn't a purchase of this app made with that gateway.
 */
export async function procesarPago(
  store: ManualesStore,
  pasarela: Pasarela,
  pagoId: string,
  hoy: string
): Promise<{ resultado: ResultadoPago; orden?: string; vence?: string | null }> {
  const p = await pasarela.pago(pagoId);
  if (!p || !esOrden(p.referencia)) return { resultado: "ajeno" };
  const orden = await store.getOrden(p.referencia);
  if (!orden || orden.pasarela !== pasarela.id) return { resultado: "ajeno" };
  const r = await aplicar(store, orden.id, p, hoy);
  return { resultado: r.resultado === "no-existe" ? "ajeno" : r.resultado, orden: orden.id, vence: r.vence };
}

/** A pending purchase checked against its gateway (in case its notification didn't arrive). Returns it updated. */
export async function verificarOrden(store: ManualesStore, pasarelas: Pasarelas, orden: Orden, hoy: string): Promise<Orden> {
  const pasarela = pasarelas[orden.pasarela];
  if (orden.estado !== "pendiente" || !pasarela) return orden;
  const pagos = await pasarela.buscarPagos(orden.id);
  const aprobado = pagos.find((p) => p.estado === "approved");
  const pago = aprobado ?? pagos[0];
  if (pago && (aprobado || pago.estado !== orden.estadoPago || pago.detalle !== orden.detallePago)) await aplicar(store, orden.id, pago, hoy);
  return (await store.getOrden(orden.id)) ?? orden;
}

/** The daily check: purchases of the last days still pending are checked against their gateway. */
export async function conciliarPendientes(
  store: ManualesStore,
  pasarelas: Pasarelas,
  hoy: string,
  ahora = Date.now()
): Promise<{ revisadas: number; aprobadas: number; errores: number }> {
  const pendientes = await store.listarOrdenes({ estado: "pendiente", desde: new Date(ahora - 3 * 86_400_000).toISOString(), limite: 50 });
  let aprobadas = 0;
  let errores = 0;
  for (const o of pendientes) {
    try {
      if ((await verificarOrden(store, pasarelas, o, hoy)).estado !== "pendiente") aprobadas++;
    } catch (err) {
      errores++;
      console.error(`[manuales] revisar la compra ${o.id}:`, err);
    }
  }
  return { revisadas: pendientes.length, aprobadas, errores };
}

/** The purchase as its buyer sees it. */
export function estadoCompra(o: Orden): EstadoCompra {
  return {
    orden: o.id,
    estado: o.estado,
    pasarela: o.pasarela,
    estadoPago: o.estadoPago,
    detallePago: o.detallePago,
    meses: o.meses,
    monto: o.monto,
    moneda: o.moneda,
    vence: o.venceNueva,
    texto: textoEstadoPago(o.estadoPago, o.detallePago),
  };
}
