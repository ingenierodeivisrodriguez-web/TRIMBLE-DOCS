// Mercado Pago (Checkout Pro) for selling licenses to read the manuals: a
// "preference" is the checkout the buyer pays in, and each payment carries
// our order id as `external_reference`. Credentials only come from Vercel's
// environment variables (MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET).
import { createHmac, timingSafeEqual } from "node:crypto";
import { ManualesError } from "./service";

const API = "https://api.mercadopago.com";

export interface MpConfig {
  accessToken: string;
  /** "Clave secreta" of the webhook in Mercado Pago's panel: when set, signed notifications are verified. */
  webhookSecret: string | null;
  /** Old-style test credentials ("TEST-..."): the checkout opens in Mercado Pago's sandbox. */
  prueba: boolean;
}

/** The Mercado Pago account the credentials belong to. */
export interface CuentaMp {
  id: string;
  nombre: string;
  email: string;
  /** A test account: today's test credentials start with APP_USR- like the real ones, so this is how to tell them apart. */
  prueba: boolean;
}

export function mpConfig(): MpConfig | null {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return { accessToken, webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || null, prueba: accessToken.startsWith("TEST-") };
}

/** A payment as Mercado Pago reports it. */
export interface PagoMp {
  id: string;
  /** approved, pending, in_process, rejected, cancelled, refunded, charged_back... */
  estado: string;
  detalle: string;
  /** Our order id. */
  referencia: string | null;
  monto: number;
  moneda: string;
  aprobado: string | null;
}

export interface NuevaPreferencia {
  referencia: string;
  titulo: string;
  descripcion: string;
  monto: number;
  moneda: string;
  /** Where the buyer lands after paying (https), and where Mercado Pago notifies (null on localhost). */
  retorno: string;
  notificacion: string | null;
}

export interface Mp {
  /** Whose credentials these are (and whether it is a test account). */
  cuenta(): Promise<CuentaMp>;
  /** The checkout for an order; `url` is where the buyer pays. */
  crearPreferencia(p: NuevaPreferencia): Promise<{ id: string; url: string }>;
  /** null when Mercado Pago doesn't know that payment. */
  pago(id: string): Promise<PagoMp | null>;
  /** The payments made for an order (newest first). */
  buscarPagos(referencia: string): Promise<PagoMp[]>;
}

interface PagoRaw {
  id: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string | null;
}

function toPago(r: PagoRaw): PagoMp {
  return {
    id: String(r.id),
    estado: r.status ?? "",
    detalle: r.status_detail ?? "",
    referencia: r.external_reference || null,
    monto: Number(r.transaction_amount ?? 0),
    moneda: r.currency_id ?? "",
    aprobado: r.date_approved ?? null,
  };
}

export function mercadoPago(cfg: MpConfig, fetchImpl: typeof fetch = fetch): Mp {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new ManualesError("No se pudo contactar a Mercado Pago. Inténtalo de nuevo en unos minutos.", 502, "mercadopago");
    }
    if (res.ok || res.status === 404) return res;
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new ManualesError("Mercado Pago rechazó las credenciales (MERCADOPAGO_ACCESS_TOKEN en Vercel).", 502, "mercadopago-credenciales");
    }
    let detalle = "";
    try {
      detalle = JSON.parse(body).message ?? "";
    } catch {
      // not JSON
    }
    throw new ManualesError(`Mercado Pago respondió ${res.status}${detalle ? `: ${detalle}` : ""}.`, 502, "mercadopago");
  }

  return {
    async cuenta() {
      const res = await call("/users/me");
      if (res.status === 404) throw new ManualesError("Mercado Pago no reconoce la cuenta de las credenciales.", 502, "mercadopago-credenciales");
      const r = (await res.json()) as { id?: number | string; nickname?: string; email?: string; tags?: string[] };
      return {
        id: String(r.id ?? ""),
        nombre: r.nickname ?? "",
        email: r.email ?? "",
        prueba: cfg.prueba || (r.tags ?? []).includes("test_user"),
      };
    },
    async crearPreferencia(p) {
      const https = p.retorno.startsWith("https://");
      const body = {
        items: [{ id: p.referencia, title: p.titulo, description: p.descripcion, quantity: 1, currency_id: p.moneda, unit_price: p.monto }],
        external_reference: p.referencia,
        metadata: { orden: p.referencia },
        back_urls: { success: p.retorno, pending: p.retorno, failure: p.retorno },
        // Mercado Pago only returns by itself to public https addresses.
        ...(https ? { auto_return: "approved" } : {}),
        ...(p.notificacion ? { notification_url: p.notificacion } : {}),
      };
      const res = await call("/checkout/preferences", { method: "POST", headers: { "X-Idempotency-Key": p.referencia }, body: JSON.stringify(body) });
      if (res.status === 404) throw new ManualesError("Mercado Pago no pudo crear el pago.", 502, "mercadopago");
      const r = (await res.json()) as { id: string; init_point?: string; sandbox_init_point?: string };
      const url = (cfg.prueba ? r.sandbox_init_point : r.init_point) ?? r.init_point;
      if (!r.id || !url) throw new ManualesError("Mercado Pago no devolvió el enlace de pago.", 502, "mercadopago");
      return { id: r.id, url };
    },
    async pago(id) {
      if (!/^\d{1,20}$/.test(id)) return null;
      const res = await call(`/v1/payments/${id}`);
      if (res.status === 404) return null;
      return toPago((await res.json()) as PagoRaw);
    },
    async buscarPagos(referencia) {
      const q = new URLSearchParams({ external_reference: referencia, sort: "date_created", criteria: "desc", limit: "20" });
      const res = await call(`/v1/payments/search?${q}`);
      if (res.status === 404) return [];
      const r = (await res.json()) as { results?: PagoRaw[] };
      return (r.results ?? []).map(toPago);
    },
  };
}

/**
 * Whether a notification really comes from Mercado Pago: the `x-signature`
 * header ("ts=...,v1=<hex>") is the HMAC-SHA256, keyed with the webhook's
 * secret, of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (parts that
 * are missing are left out; alphanumeric ids in lower case).
 */
export function firmaValida(secret: string, xSignature: string | null, xRequestId: string | null, dataId: string | null): boolean {
  if (!xSignature) return false;
  const partes = new Map<string, string>();
  for (const parte of xSignature.split(",")) {
    const i = parte.indexOf("=");
    if (i > 0) partes.set(parte.slice(0, i).trim(), parte.slice(i + 1).trim());
  }
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  let manifiesto = "";
  if (dataId) manifiesto += `id:${dataId.toLowerCase()};`;
  if (xRequestId) manifiesto += `request-id:${xRequestId};`;
  manifiesto += `ts:${ts};`;
  const esperado = createHmac("sha256", secret).update(manifiesto).digest();
  const recibido = Buffer.from(v1, "hex");
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}
