// What the license sales need from a payment gateway (Mercado Pago, Wompi):
// start a payment for an order, and read its payments back. Payments are
// always read from the gateway itself before applying them.

export type IdPasarela = "mercadopago" | "wompi";

export const PASARELAS: IdPasarela[] = ["mercadopago", "wompi"];

export const NOMBRE_PASARELA: Record<IdPasarela, string> = { mercadopago: "Mercado Pago", wompi: "Wompi" };

export function esPasarela(id: unknown): id is IdPasarela {
  return id === "mercadopago" || id === "wompi";
}

/**
 * A payment as the gateway reports it. `estado` uses one vocabulary for
 * every gateway (Mercado Pago's): approved, pending, in_process, rejected,
 * cancelled, refunded, charged_back...; `detalle` keeps the gateway's own.
 */
export interface PagoPasarela {
  id: string;
  estado: string;
  detalle: string;
  /** Our order id. */
  referencia: string | null;
  /** In pesos. */
  monto: number;
  moneda: string;
}

/** A payment to start for an order. */
export interface Cobro {
  referencia: string;
  titulo: string;
  descripcion: string;
  /** In whole pesos. */
  monto: number;
  moneda: string;
  /** The buyer's e-mail and name, to prefill the checkout when the gateway allows it. */
  email: string;
  nombre: string;
  /** Where the buyer lands after paying, and where the gateway notifies (null when it is configured in its dashboard, or this app isn't public). */
  retorno: string;
  notificacion: string | null;
}

export interface Pasarela {
  id: IdPasarela;
  /** Test credentials: payments are simulated. */
  prueba: boolean;
  /** Where the buyer pays (and the gateway's id for the checkout, when it has one). */
  crearCobro(c: Cobro): Promise<{ id: string | null; url: string }>;
  /** null when the gateway doesn't know that payment. */
  pago(id: string): Promise<PagoPasarela | null>;
  /** The payments made for an order (newest first). */
  buscarPagos(referencia: string): Promise<PagoPasarela[]>;
}

/** The gateways configured in Vercel. */
export type Pasarelas = Partial<Record<IdPasarela, Pasarela>>;
