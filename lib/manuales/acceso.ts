// Who reads the manuals and with what: people the administrator authorizes
// (by e-mail) read them through the technical account, a Trimble Connect
// user that is a member of "MANAGER PROJECT". Readers never need access to
// that project; administrators of it manage the account and the list.
import { EstadoLicencia, esFecha, estadoLicencia, fechaVisible, MAX_MESES, sumarMeses, vigente } from "./licencia";
import { cifrar, descifrar, OauthConfig, TokenError, Tokens } from "./oauth";
import { ManualesError } from "./service";
import type { Autorizado, Licencia, ManualesStore } from "./store";
import type { AutorizadoInfo } from "./types";

export const NO_AUTORIZADO =
  "No tiene acceso. Pide al administrador de los manuales que te autorice con tu correo de Trimble Connect.";

/** Renew the session when less than this is left. */
const MARGEN_MS = 5 * 60 * 1000;
/** The daily keep-alive renews when the last renewal is older than this (Trimble asks for at most 9 days). */
const RENOVAR_CADA_MS = 20 * 60 * 60 * 1000;

export interface CuentaDeps {
  oauth: OauthConfig | null;
  renovar(cfg: OauthConfig, refreshToken: string): Promise<Tokens>;
  esperar(ms: number): Promise<void>;
  ahora(): number;
}

let enMemoria: { access: string; expira: number; secret: string } | null = null;

/** Forgets the token cached in this instance (after connecting or disconnecting the account). */
export function olvidarToken() {
  enMemoria = null;
}

function requireOauth(deps: CuentaDeps): OauthConfig {
  if (!deps.oauth) {
    throw new ManualesError(
      "Falta la variable TRIMBLE_CLIENT_SECRET en Vercel (el Client Secret de la app \"apibasedatos\"): sin ella la app no puede usar la cuenta técnica.",
      503,
      "sin-oauth"
    );
  }
  return deps.oauth;
}

const VENCIDA = () =>
  new ManualesError("La sesión de la cuenta técnica venció: el administrador de los manuales debe volver a conectarla.", 503, "cuenta-vencida");

/**
 * A valid access token of the technical account. Renews it when it is about
 * to expire; as refresh tokens are single-use, only the instance holding the
 * turn renews, and the others wait for its result.
 */
export async function tokenTecnico(store: ManualesStore, deps: CuentaDeps, forzar = false): Promise<string> {
  const cfg = requireOauth(deps);
  if (!forzar && enMemoria && enMemoria.secret === cfg.secret && enMemoria.expira - deps.ahora() > MARGEN_MS) return enMemoria.access;
  for (let intento = 0; intento < 30; intento++) {
    const c = await store.getCuenta();
    if (!c) throw new ManualesError("Los manuales aún no están disponibles: el administrador debe conectar la cuenta técnica.", 503, "sin-cuenta");
    const vigente = c.accessCifrado && c.accessExpira && Date.parse(c.accessExpira) - deps.ahora() > MARGEN_MS;
    if (vigente && !(forzar && intento === 0)) {
      let access: string;
      try {
        access = descifrar(c.accessCifrado!, cfg.secret);
      } catch {
        throw VENCIDA(); // the secret changed: the stored tokens can't be read
      }
      enMemoria = { access, expira: Date.parse(c.accessExpira!), secret: cfg.secret };
      return access;
    }
    if (await store.tomarTurno(30)) {
      try {
        let refresh: string;
        try {
          refresh = descifrar(c.refreshCifrado, cfg.secret);
        } catch {
          throw VENCIDA();
        }
        const t = await deps.renovar(cfg, refresh);
        await store.guardarTokens({
          refreshCifrado: cifrar(t.refreshToken, cfg.secret),
          accessCifrado: cifrar(t.accessToken, cfg.secret),
          accessExpira: new Date(t.expiresAt).toISOString(),
        });
        enMemoria = { access: t.accessToken, expira: t.expiresAt, secret: cfg.secret };
        return t.accessToken;
      } catch (err) {
        await store.soltarTurno().catch(() => undefined);
        if (err instanceof TokenError && err.vencido) throw VENCIDA();
        throw err;
      }
    }
    await deps.esperar(500); // someone else is renewing it
  }
  throw new ManualesError("La sesión de la cuenta técnica se está renovando; inténtalo de nuevo en unos segundos.", 503, "cuenta-ocupada");
}

/** The daily keep-alive: renews the session if the last renewal is old, so it never lapses. */
export async function mantenerSesion(store: ManualesStore, deps: CuentaDeps): Promise<"renovada" | "al-dia" | "sin-cuenta"> {
  const c = await store.getCuenta();
  if (!c) return "sin-cuenta";
  if (deps.ahora() - Date.parse(c.renovadaEn) < RENOVAR_CADA_MS) return "al-dia";
  await tokenTecnico(store, deps, true);
  return "renovada";
}

// ---------------------------------------------------------------- people

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function normalizarEmail(text: string): string | null {
  const email = text.trim().toLowerCase();
  return email.length <= 200 && EMAIL_RE.test(email) ? email : null;
}

/** "ana@x.com, Luis <luis@y.com>\n..." -> the valid e-mails, and the pieces that aren't. */
export function leerEmails(text: string): { emails: { email: string; nombre: string }[]; invalidos: string[] } {
  const emails = new Map<string, { email: string; nombre: string }>();
  const invalidos: string[] = [];
  for (const parte of text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.*?)<([^>]+)>$/.exec(parte);
    const email = normalizarEmail(m ? m[2] : parte);
    if (!email) invalidos.push(parte);
    else emails.set(email, { email, nombre: m ? m[1].trim().replace(/^"|"$/g, "") : emails.get(email)?.nombre ?? "" });
  }
  return { emails: [...emails.values()], invalidos };
}

export type Motivo = "sin-autorizacion" | "vencida" | "suspendida";

export interface Lectura {
  /** Authorized with a license in force. */
  autorizado: boolean;
  esAdmin: boolean;
  /** Why an authorized-looking person can't read (null when they can, or are administrators). */
  motivo: Motivo | null;
  licencia: { estado: EstadoLicencia; vence: string | null; diasRestantes: number | null } | null;
}

/**
 * Whether the caller can read the manuals: authorized by e-mail with a
 * license in force (not expired, not suspended), or an administrator of the
 * manager project.
 */
export async function puedeLeer(store: ManualesStore, email: string | null, esAdmin: () => Promise<boolean>, hoy: string): Promise<Lectura> {
  const a = email ? await store.getAutorizado(email.toLowerCase()) : null;
  const admin = await esAdmin().catch(() => false);
  if (!a) return { autorizado: false, esAdmin: admin, motivo: admin ? null : "sin-autorizacion", licencia: null };
  const { estado, diasRestantes } = estadoLicencia(a, hoy);
  const ok = vigente(estado);
  return {
    autorizado: ok,
    esAdmin: admin,
    motivo: ok || admin ? null : estado === "suspendida" ? "suspendida" : "vencida",
    licencia: { estado, vence: a.vence, diasRestantes },
  };
}

/** What a blocked person reads. */
export function mensajeSinAcceso(l: Lectura): string {
  if (l.motivo === "vencida") return `No tiene acceso: su licencia para leer los manuales venció el ${fechaVisible(l.licencia?.vence ?? null)}. Pida al administrador que la renueve.`;
  if (l.motivo === "suspendida") return "No tiene acceso: su acceso a los manuales está suspendido. Pida al administrador que lo reactive.";
  return NO_AUTORIZADO;
}

export function requireAdmin(esAdmin: boolean) {
  if (!esAdmin) throw new ManualesError("Solo los administradores del proyecto de manuales administran el acceso.", 403, "no-admin");
}

/**
 * The license an administrator chose: { meses: 1..12, inicio? } (from
 * `inicio`, today by default), { vence } (up to a date), or { sinVencimiento: true }.
 */
export function leerLicencia(body: unknown, hoy: string): Omit<Licencia, "suspendido"> {
  const o = (body ?? {}) as { meses?: unknown; inicio?: unknown; vence?: unknown; sinVencimiento?: unknown };
  if (o.sinVencimiento === true) return { licenciaMeses: null, inicio: null, vence: null };
  if (o.inicio !== undefined && o.inicio !== null && !esFecha(o.inicio)) throw new ManualesError("La fecha de inicio no es válida.", 400, "parametro");
  const inicio = (o.inicio as string | undefined) || hoy;
  if (o.meses !== undefined && o.meses !== null) {
    if (!Number.isInteger(o.meses) || (o.meses as number) < 1 || (o.meses as number) > MAX_MESES) {
      throw new ManualesError(`La licencia debe ser de 1 a ${MAX_MESES} meses.`, 400, "parametro");
    }
    return { licenciaMeses: o.meses as number, inicio, vence: sumarMeses(inicio, o.meses as number) };
  }
  if (o.vence !== undefined && o.vence !== null) {
    if (!esFecha(o.vence)) throw new ManualesError("La fecha de vencimiento no es válida.", 400, "parametro");
    if (o.vence < inicio) throw new ManualesError("El vencimiento no puede ser antes del inicio.", 400, "parametro");
    return { licenciaMeses: null, inicio, vence: o.vence };
  }
  throw new ManualesError("Indica la licencia: de 1 a 12 meses, hasta una fecha o sin vencimiento.", 400, "parametro");
}

export async function agregar(store: ManualesStore, body: unknown, por: string, hoy: string): Promise<{ agregados: number; invalidos: string[] }> {
  const texto = (body as { texto?: unknown } | null)?.texto;
  if (typeof texto !== "string" || !texto.trim()) throw new ManualesError("Escribe uno o varios correos.", 400, "parametro");
  if (texto.length > 50_000) throw new ManualesError("Son demasiados correos de una vez.", 400, "parametro");
  const licencia = leerLicencia((body as { licencia?: unknown }).licencia ?? { meses: MAX_MESES }, hoy);
  const { emails, invalidos } = leerEmails(texto);
  if (emails.length > 1000) throw new ManualesError("Máximo 1.000 correos de una vez.", 400, "parametro");
  await store.agregarAutorizados(emails, por, { ...licencia, suspendido: false });
  return { agregados: emails.length, invalidos };
}

/** Changes a person's license ({ email, licencia? } with the same forms as above) or suspends / reactivates them ({ email, suspendido }). */
export async function actualizar(store: ManualesStore, body: unknown, hoy: string): Promise<void> {
  const o = (body ?? {}) as { email?: unknown; licencia?: unknown; suspendido?: unknown };
  const email = typeof o.email === "string" ? normalizarEmail(o.email) : null;
  if (!email) throw new ManualesError("Correo no válido.", 400, "parametro");
  const cambios: Partial<Licencia> = {};
  if (o.licencia !== undefined) Object.assign(cambios, leerLicencia(o.licencia, hoy));
  if (o.suspendido !== undefined) {
    if (typeof o.suspendido !== "boolean") throw new ManualesError("Estado no válido.", 400, "parametro");
    cambios.suspendido = o.suspendido;
  }
  if (!Object.keys(cambios).length) throw new ManualesError("No hay cambios.", 400, "parametro");
  if (!(await store.actualizarLicencia(email, cambios))) throw new ManualesError("Ese correo no está autorizado.", 404, "no-existe");
}

export async function quitar(store: ManualesStore, email: unknown): Promise<void> {
  const e = typeof email === "string" ? normalizarEmail(email) : null;
  if (!e) throw new ManualesError("Correo no válido.", 400, "parametro");
  if (!(await store.quitarAutorizado(e))) throw new ManualesError("Ese correo no estaba autorizado.", 404, "no-existe");
}

/** A person as the administration screen shows them, with their license's status today. */
export function infoAutorizado(a: Autorizado, hoy: string): AutorizadoInfo {
  return { ...a, ...estadoLicencia(a, hoy) };
}

export type { Autorizado };
