// The user's Trimble Connect access token, as the extension receives it from
// the host: the result of extension.requestPermission("accesstoken") or the
// payload of the "extension.accessToken" event. Both can also carry a status
// word ("pending", "denied"), which must never be sent as a token.

const STATUS_WORDS = new Set(["pending", "denied", "granted", "approved", "accesstoken"]);

/** The token in an "extension.accessToken" payload: the string itself, { data } or { accessToken }. */
export function tokenFrom(data: unknown): string {
  if (typeof data === "string") return data;
  const d = data as { data?: unknown; accessToken?: unknown } | null;
  if (typeof d?.data === "string") return d.data;
  if (typeof d?.accessToken === "string") return d.accessToken;
  return "";
}

/** True for something that can be an access token (not empty, not a status word). */
export function isTokenLike(value: string): boolean {
  return value.length >= 20 && !/\s/.test(value) && !STATUS_WORDS.has(value.toLowerCase());
}

/** Expiry of a JWT access token in ms since epoch, or null when it isn't a readable JWT. */
export function tokenExpiresAt(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof json?.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Whether a JWT token expires within `marginMs` (unknown expiry counts as not expiring). */
export function expiresSoon(token: string, now = Date.now(), marginMs = 60_000): boolean {
  const exp = tokenExpiresAt(token);
  return exp !== null && exp - now < marginMs;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A description of the token that is safe to show (never the token itself):
 * its shape, length, where it came from and its expiry. Used in error messages
 * when Trimble Connect rejects it, to tell an expired token from a wrong one.
 */
export function describeToken(token: string, source: string, now = Date.now()): string {
  if (!token) return "no se recibió ningún token";
  const exp = tokenExpiresAt(token);
  const shape = token.split(".").length === 3 ? "JWT" : "no JWT";
  const parts = [`token ${shape} de ${token.length.toLocaleString("es")} caracteres`, `recibido por ${source || "desconocido"}`];
  if (exp !== null) parts.push(exp <= now ? `venció el ${stamp(exp)}` : `vence el ${stamp(exp)}`);
  return parts.join(", ");
}
