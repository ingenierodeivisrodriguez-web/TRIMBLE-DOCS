// Connecting the technical account: Trimble Identity's authorization code
// flow (with PKCE), and refreshing its session afterwards. Trimble Connect
// doesn't accept client-credentials tokens, so a person signs in once with
// the account and the server keeps its (single-use, rotating) refresh token.
// https://developer.trimble.com/docs/authentication/guides/authorization-code/
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const AUTHORIZE = "https://id.trimble.com/oauth/authorize";
const TOKEN = "https://id.trimble.com/oauth/token";
const REVOKE = "https://id.trimble.com/oauth/revoke";

/** The app registered in Trimble Developer Console ("apibasedatos"); the client id isn't secret. */
const CLIENT_ID = "31d42c3e-aacc-492e-a3a1-fd9903ae2c50";
const APP_NAME = "apibasedatos";

export interface OauthConfig {
  clientId: string;
  secret: string;
  scope: string;
}

/** Null until TRIMBLE_CLIENT_SECRET is set in Vercel. */
export function oauthConfig(): OauthConfig | null {
  const secret = process.env.TRIMBLE_CLIENT_SECRET?.trim();
  if (!secret) return null;
  return {
    clientId: process.env.TRIMBLE_CLIENT_ID?.trim() || CLIENT_ID,
    secret,
    scope: `openid ${process.env.TRIMBLE_APP_NAME?.trim() || APP_NAME}`,
  };
}

export class TokenError extends Error {
  constructor(
    message: string,
    /** The refresh token is no longer valid: the account must be connected again. */
    public vencido: boolean
  ) {
    super(message);
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch. */
  expiresAt: number;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function nuevoPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

export function authorizeUrl(cfg: OauthConfig, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

async function pedirTokens(cfg: OauthConfig, body: Record<string, string>, anterior?: string): Promise<Tokens> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const detalle = data.error_description || data.error || `HTTP ${res.status}`;
    const vencido = data.error === "invalid_grant" || res.status === 400 || res.status === 401;
    throw new TokenError(`Trimble Identity rechazó la solicitud (${detalle}).`, vencido);
  }
  const refreshToken = data.refresh_token || anterior;
  if (!refreshToken) throw new TokenError("Trimble Identity no entregó un refresh token para mantener la sesión.", true);
  return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

export function canjearCodigo(cfg: OauthConfig, code: string, redirectUri: string, verifier: string): Promise<Tokens> {
  return pedirTokens(cfg, { grant_type: "authorization_code", code, client_id: cfg.clientId, redirect_uri: redirectUri, code_verifier: verifier });
}

export function renovar(cfg: OauthConfig, refreshToken: string): Promise<Tokens> {
  return pedirTokens(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);
}

/** Best effort: the refresh token stops working at Trimble Identity. */
export async function revocar(cfg: OauthConfig, refreshToken: string): Promise<void> {
  await fetch(REVOKE, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }).toString(),
    cache: "no-store",
  }).catch(() => undefined);
}

// ---------------------------------------------------------------- tokens at rest

/** AES-256-GCM with a key derived from the client secret (a stolen row is useless without it). */
function clave(secret: string): Buffer {
  return createHash("sha256").update(`manuales:${secret}`).digest();
}

export function cifrar(texto: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(secret), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), datos]).toString("base64");
}

export function descifrar(cifrado: string, secret: string): string {
  const buf = Buffer.from(cifrado, "base64");
  const d = createDecipheriv("aes-256-gcm", clave(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
