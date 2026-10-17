import { StoreError } from "../propiedades/store";

/**
 * The Supabase REST API with the server-only key, as Compras uses it: the
 * caller decides what an error answer means (`traducir`), reads that run out
 * of time are tried once more, and long lists come a page at a time.
 */
export interface ClienteSupabase {
  call(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
  /** Every row of a GET query, a page at a time. */
  all<T>(path: string): Promise<T[]>;
}

/** What a failed answer means: return the error to throw, or null for the generic one. */
export type Traductor = (status: number, body: string, detail: { code?: string; message?: string }) => Error | null;

const REQUEST_TIMEOUT_MS = 20_000;
const PAGE = 1000;
export const LENTA = "La base de datos (Supabase) tardó demasiado en responder. Intenta de nuevo en un momento.";
const esTiempo = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

export const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

/** null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. */
export function clienteSupabase(traducir: Traductor): ClienteSupabase | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;

  const rest = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs; the newer "sb_secret_…" keys only go as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${rest}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      if (esTiempo(err) && init.method && init.method !== "GET") throw new StoreError(LENTA, 504);
      throw err;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    let detail: { code?: string; message?: string } = {};
    try {
      detail = JSON.parse(body);
    } catch {
      // not JSON
    }
    const propio = traducir(res.status, body, detail);
    if (propio) throw propio;
    if (res.status === 401 || res.status === 403) {
      throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    throw new StoreError(`Supabase respondió ${res.status}${detail.message ? `: ${detail.message}` : ""}`);
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const lectura = !init?.method || init.method === "GET";
    for (let intento = 0; ; intento++) {
      try {
        return (await (await call(path, init)).json()) as T;
      } catch (err) {
        if (!esTiempo(err)) throw err;
        if (lectura && intento === 0) continue;
        throw new StoreError(LENTA, 504);
      }
    }
  }

  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await json<T[]>(`${path}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  return { call, json, all };
}

/** A missing table or function: the SQL file hasn't been run. */
export function faltaTabla(body: string): boolean {
  return /PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body);
}
