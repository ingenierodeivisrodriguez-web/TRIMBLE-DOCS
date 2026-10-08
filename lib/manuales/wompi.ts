// Wompi (Bancolombia) for selling licenses to read the manuals: the buyer
// pays in Wompi's Web Checkout, signed with our integrity secret so the
// amount and reference can't be changed, and each transaction carries our
// order id as `reference`. Keys only come from Vercel's environment
// variables (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_PRIVATE_KEY,
// WOMPI_EVENTS_SECRET); test keys (pub_test_...) use Wompi's Sandbox.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Pasarela, PagoPasarela } from "./pasarelas";
import { ManualesError } from "./service";

const CHECKOUT = "https://checkout.wompi.co/p/";

export interface WompiConfig {
  publicKey: string;
  /** "Integridad": signs each checkout (amount, reference, currency). */
  integritySecret: string;
  /** Lets the app look up an order's transactions by its reference (also tried with the public key). */
  privateKey: string | null;
  /** "Eventos": when set, event notifications must carry a valid checksum. */
  eventsSecret: string | null;
  prueba: boolean;
  /** https://sandbox.wompi.co/v1 or https://production.wompi.co/v1 */
  api: string;
}

export function wompiConfig(): WompiConfig | null {
  const publicKey = process.env.WOMPI_PUBLIC_KEY?.trim();
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET?.trim();
  if (!publicKey || !integritySecret) return null;
  const prueba = publicKey.startsWith("pub_test_");
  return {
    publicKey,
    integritySecret,
    privateKey: process.env.WOMPI_PRIVATE_KEY?.trim() || null,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET?.trim() || null,
    prueba,
    api: prueba ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1",
  };
}

/** Keys of different environments (a test key with a production one) or that don't look like Wompi's. */
export function problemasWompi(cfg: WompiConfig): string[] {
  const entorno = cfg.prueba ? "test" : "prod";
  const out: string[] = [];
  if (!/^pub_(test|prod)_/.test(cfg.publicKey)) out.push("WOMPI_PUBLIC_KEY no parece una llave pública de Wompi (empieza por pub_test_ o pub_prod_).");
  if (!cfg.integritySecret.startsWith(`${entorno}_integrity_`)) out.push(`WOMPI_INTEGRITY_SECRET debe ser el secreto de integridad del mismo ambiente (empieza por ${entorno}_integrity_).`);
  if (cfg.privateKey && !cfg.privateKey.startsWith(`prv_${entorno}_`)) out.push(`WOMPI_PRIVATE_KEY debe ser la llave privada del mismo ambiente (empieza por prv_${entorno}_).`);
  if (cfg.eventsSecret && !cfg.eventsSecret.startsWith(`${entorno}_events_`)) out.push(`WOMPI_EVENTS_SECRET debe ser el secreto de eventos del mismo ambiente (empieza por ${entorno}_events_).`);
  return out;
}

/** SHA256 of "<reference><amount-in-cents><currency><integrity secret>", as Wompi checks it. */
export function firmaIntegridad(referencia: string, montoCentavos: number, moneda: string, secreto: string): string {
  return createHash("sha256").update(`${referencia}${montoCentavos}${moneda}${secreto}`).digest("hex");
}

interface TransaccionRaw {
  id: string;
  status?: string;
  status_message?: string | null;
  reference?: string | null;
  amount_in_cents?: number;
  currency?: string;
}

/** Wompi's statuses in the common vocabulary (Mercado Pago's). */
const ESTADOS: Record<string, string> = { APPROVED: "approved", PENDING: "pending", DECLINED: "rejected", ERROR: "rejected", VOIDED: "refunded" };

function toPago(t: TransaccionRaw): PagoPasarela {
  const status = (t.status ?? "").toUpperCase();
  return {
    id: String(t.id),
    estado: ESTADOS[status] ?? status.toLowerCase(),
    detalle: t.status_message ? `${status}: ${t.status_message}` : status,
    referencia: t.reference || null,
    monto: Number(t.amount_in_cents ?? 0) / 100,
    moneda: t.currency ?? "",
  };
}

const ID_RE = /^[A-Za-z0-9-]{5,80}$/;

export function wompi(cfg: WompiConfig, fetchImpl: typeof fetch = fetch): Pasarela {
  async function call(path: string, llave: string | null): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.api}${path}`, {
        headers: llave ? { Authorization: `Bearer ${llave}` } : {},
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new ManualesError("No se pudo contactar a Wompi. Inténtalo de nuevo en unos minutos.", 502, "wompi");
    }
    if (res.ok || res.status === 404) return res;
    if (res.status === 401 || res.status === 403) throw new ManualesError("Wompi rechazó las llaves (WOMPI_... en Vercel).", 502, "wompi-credenciales");
    throw new ManualesError(`Wompi respondió ${res.status}.`, 502, "wompi");
  }

  return {
    id: "wompi",
    prueba: cfg.prueba,
    async crearCobro(c) {
      const centavos = Math.round(c.monto * 100);
      const q = new URLSearchParams({
        "public-key": cfg.publicKey,
        currency: c.moneda,
        "amount-in-cents": String(centavos),
        reference: c.referencia,
        "signature:integrity": firmaIntegridad(c.referencia, centavos, c.moneda, cfg.integritySecret),
        "redirect-url": c.retorno,
      });
      if (c.email) q.set("customer-data:email", c.email);
      if (c.nombre) q.set("customer-data:full-name", c.nombre);
      return { id: null, url: `${CHECKOUT}?${q}` };
    },
    async pago(id) {
      if (!ID_RE.test(id)) return null;
      const res = await call(`/transactions/${encodeURIComponent(id)}`, null);
      if (res.status === 404) return null;
      const r = (await res.json()) as { data?: TransaccionRaw };
      return r.data ? toPago(r.data) : null;
    },
    async buscarPagos(referencia) {
      const res = await call(`/transactions?reference=${encodeURIComponent(referencia)}`, cfg.privateKey ?? cfg.publicKey);
      if (res.status === 404) return [];
      const r = (await res.json()) as { data?: TransaccionRaw[] | TransaccionRaw };
      const lista = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
      // Only this order's transactions, whatever the filter returned.
      return lista.filter((t) => t.reference === referencia).map(toPago);
    },
  };
}

export interface EventoWompi {
  event?: string;
  data?: { transaction?: TransaccionRaw } & Record<string, unknown>;
  environment?: string;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
}

/**
 * Whether an event really comes from Wompi: its checksum is the SHA256 of
 * the values of `signature.properties` (paths inside `data`, in that order),
 * then `timestamp`, then the events secret.
 */
export function eventoValido(evento: EventoWompi, secreto: string, checksumCabecera: string | null = null): boolean {
  const props = evento.signature?.properties;
  const recibido = (checksumCabecera || evento.signature?.checksum || "").toLowerCase();
  if (!Array.isArray(props) || !props.length || evento.timestamp === undefined || !/^[0-9a-f]{64}$/.test(recibido)) return false;
  let texto = "";
  for (const prop of props) {
    let valor: unknown = evento.data;
    for (const parte of String(prop).split(".")) valor = valor && typeof valor === "object" ? (valor as Record<string, unknown>)[parte] : undefined;
    if (valor === undefined || valor === null) return false;
    texto += String(valor);
  }
  texto += String(evento.timestamp) + secreto;
  const esperado = createHash("sha256").update(texto).digest();
  return timingSafeEqual(Buffer.from(recibido, "hex"), esperado);
}
