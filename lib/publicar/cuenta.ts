/**
 * The connected account of "Publicar entre proyectos": the Trimble Connect
 * user who belongs to both projects (origin: reading what it publishes;
 * destination: writing in the reception folder), so copies don't wait for
 * that person to open the extension. A person allowed in
 * PUBLICAR_ADMINS signs in with it once (Trimble Identity, authorization code
 * with PKCE, the same app as Manuales); the server keeps its rotating
 * refresh token encrypted and renews it (daily keep-alive, see /api/publicar/mantener).
 */
import { leerRetorno } from "../manuales/conexion";
import { authorizeUrl, cifrar, descifrar, nuevoPkce, OauthConfig, TokenError, Tokens } from "../manuales/oauth";
import { PublicarError } from "./errores";
import type { PublicarStore } from "./store";
import type { CuentaInfo } from "./types";

export interface DepsCuenta {
  oauth: OauthConfig | null;
  renovar(cfg: OauthConfig, refreshToken: string): Promise<Tokens>;
  canjear(cfg: OauthConfig, code: string, redirectUri: string, verifier: string): Promise<Tokens>;
  revocar(cfg: OauthConfig, refreshToken: string): Promise<void>;
  /** Who an access token belongs to (GET /users/me). */
  usuario(accessToken: string): Promise<{ id: string; email?: string; firstName?: string; lastName?: string }>;
  /** Where Trimble Identity sends the browser back after signing in. */
  redirectUri: string;
  /** Trimble user ids allowed to connect or disconnect the account (PUBLICAR_ADMINS). */
  administradores: string[];
  esperar(ms: number): Promise<void>;
  ahora(): number;
}

/** "id1, id2" -> ["id1", "id2"]. */
export function leerAdministradores(lista: string | undefined): string[] {
  return (lista ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Renew the session when less than this is left. */
const MARGEN_MS = 5 * 60 * 1000;
/** The daily keep-alive renews when the last renewal is older than this (Trimble asks for at most 9 days). */
const RENOVAR_CADA_MS = 20 * 60 * 60 * 1000;

let enMemoria: { access: string; expira: number; secret: string } | null = null;

/** Forgets the token cached in this instance (after connecting or disconnecting, and in tests). */
export function olvidarToken() {
  enMemoria = null;
}

function exigirOauth(deps: DepsCuenta): OauthConfig {
  if (!deps.oauth) throw new PublicarError("Falta la variable TRIMBLE_CLIENT_SECRET en Vercel: sin ella no se puede conectar la cuenta.", 503, "sin-oauth");
  return deps.oauth;
}

function exigirAdministrador(deps: DepsCuenta, quien: { id: string }) {
  if (!deps.administradores.includes(quien.id)) {
    throw new PublicarError(
      `Solo las personas indicadas en la variable PUBLICAR_ADMINS de Vercel conectan la cuenta. Tu id de Trimble es ${quien.id}: agrégalo ahí y vuelve a desplegar.`,
      403,
      "no-administra"
    );
  }
}

const VENCIDA = () => new PublicarError("La sesión de la cuenta conectada venció: hay que volver a conectarla (pestaña Usuario en ambos proyectos).", 503, "cuenta-vencida");

/** What everyone sees about the account, and whether this person may manage it. */
export async function estadoCuenta(store: PublicarStore, deps: DepsCuenta, quien: { id: string }): Promise<CuentaInfo> {
  const c = await store.getCuenta();
  const faltan = [
    ...(deps.oauth ? [] : ["TRIMBLE_CLIENT_SECRET (el Client Secret de la app de Trimble, el mismo de Manuales)"]),
    ...(deps.administradores.length ? [] : ["PUBLICAR_ADMINS (los id de Trimble de quienes conectan la cuenta)"]),
  ];
  return {
    conectada: !!c,
    email: c?.cuentaEmail ?? "",
    nombre: c?.cuentaNombre ?? "",
    conectadaEn: c?.conectadaEn ?? null,
    renovadaEn: c?.renovadaEn ?? null,
    conectadaPor: c?.conectadaPor ?? null,
    administra: deps.administradores.includes(quien.id),
    miId: quien.id,
    faltan,
  };
}

/** Starts connecting: the Trimble sign-in address (valid 10 minutes). */
export async function iniciarConexion(store: PublicarStore, deps: DepsCuenta, quien: { id: string; name: string }): Promise<{ url: string }> {
  exigirAdministrador(deps, quien);
  const oauth = exigirOauth(deps);
  const { verifier, challenge, state } = nuevoPkce();
  await store.crearEstado({ state, verifier, redirectUri: deps.redirectUri, creadoPor: quien.name, expira: new Date(deps.ahora() + 10 * 60 * 1000).toISOString() });
  return { url: authorizeUrl(oauth, deps.redirectUri, state, challenge) };
}

/** Finishes connecting with the address Trimble sent the browser to (http://localhost/?code=…&state=…). */
export async function completarConexion(store: PublicarStore, deps: DepsCuenta, quien: { id: string; name: string }, enlace: string): Promise<{ ok: boolean; titulo: string; texto: string }> {
  exigirAdministrador(deps, quien);
  const oauth = exigirOauth(deps);
  if (typeof enlace !== "string" || !enlace.trim() || enlace.length > 8000) throw new PublicarError("Pega la dirección completa a la que te llevó Trimble después de iniciar sesión.");
  const retorno = leerRetorno(enlace);
  if (retorno.error) return { ok: false, titulo: "No se conectó la cuenta", texto: retorno.error };
  if (!retorno.code || !retorno.state) return { ok: false, titulo: "Dirección incompleta", texto: "La dirección no trae el código de Trimble: copia la dirección completa de la barra (empieza por http://localhost/?code=...)." };
  const estado = await store.consumirEstado(retorno.state);
  if (!estado) return { ok: false, titulo: "El enlace venció", texto: 'Pasaron más de 10 minutos o ese enlace ya se usó. Pulsa otra vez "Conectar".' };
  const tokens = await deps.canjear(oauth, retorno.code, estado.redirectUri, estado.verifier);
  const me = await deps.usuario(tokens.accessToken);
  await store.guardarCuenta({
    refreshCifrado: cifrar(tokens.refreshToken, oauth.secret),
    accessCifrado: cifrar(tokens.accessToken, oauth.secret),
    accessExpira: new Date(tokens.expiresAt).toISOString(),
    cuentaId: me.id,
    cuentaNombre: [me.firstName, me.lastName].filter(Boolean).join(" ").trim(),
    cuentaEmail: me.email ?? "",
    conectadaPor: quien.name,
  });
  olvidarToken();
  return { ok: true, titulo: "Cuenta conectada", texto: `Las copias entre proyectos donde ${me.email ?? me.id} sea miembro de los dos se harán con su cuenta, aunque no abra la extensión.` };
}

/** Disconnects it: the session stops working at Trimble and its row is deleted. */
export async function desconectar(store: PublicarStore, deps: DepsCuenta, quien: { id: string }): Promise<void> {
  exigirAdministrador(deps, quien);
  const c = await store.getCuenta();
  if (c && deps.oauth) {
    try {
      await deps.revocar(deps.oauth, descifrar(c.refreshCifrado, deps.oauth.secret));
    } catch {
      // the secret changed or Trimble didn't answer: the row goes anyway
    }
  }
  await store.borrarCuenta();
  olvidarToken();
}

/**
 * A valid access token of the account, or null when it isn't connected.
 * Renews it when it is about to expire; refresh tokens are single-use, so
 * only the instance holding the turn renews and the others wait for it.
 */
export async function tokenTecnico(store: PublicarStore, deps: DepsCuenta, forzar = false): Promise<string | null> {
  if (!deps.oauth) return null;
  const cfg = deps.oauth;
  if (!forzar && enMemoria && enMemoria.secret === cfg.secret && enMemoria.expira - deps.ahora() > MARGEN_MS) return enMemoria.access;
  for (let intento = 0; intento < 30; intento++) {
    const c = await store.getCuenta();
    if (!c) return null;
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
  throw new PublicarError("La sesión de la cuenta conectada se está renovando; inténtalo de nuevo en unos segundos.", 503, "cuenta-ocupada");
}

/** The daily keep-alive: renews the session if the last renewal is old, so it never lapses. */
export async function mantenerSesion(store: PublicarStore, deps: DepsCuenta): Promise<"renovada" | "al-dia" | "sin-cuenta"> {
  const c = await store.getCuenta();
  if (!c || !deps.oauth) return "sin-cuenta";
  if (deps.ahora() - Date.parse(c.renovadaEn) < RENOVAR_CADA_MS) return "al-dia";
  await tokenTecnico(store, deps, true);
  return "renovada";
}
