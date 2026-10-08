import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { resolveCaller } from "../propiedades/caller";
import { StoreError } from "../propiedades/store";
import {
  getCurrentUser,
  getDownloadUrl,
  getFileDetails,
  getFolderDetails,
  getProjectDetails,
  listFolderItems,
  resolveProjectBaseUrl,
  TrimbleApiError,
} from "../trimbleApi";
import { CuentaDeps, mensajeSinAcceso, puedeLeer, requireAdmin, tokenTecnico } from "./acceso";
import { hoyIso } from "./licencia";
import { ConfigManuales, configManuales } from "./config";
import type { ConexionDeps } from "./conexion";
import { canjearCodigo, oauthConfig, renovar, revocar } from "./oauth";
import { mercadoPago, Mp, MpConfig, mpConfig } from "./mercadopago";
import type { UrlsPago } from "./pagos";
import { Abierta, abrirBiblioteca, ManualesError, Tc } from "./service";
import { ManualesStore, manualesStore } from "./store";

const TTL_MS = 2 * 60 * 1000;

/** Trimble Connect through a token. */
export function tcCon(token: string): Tc {
  return {
    baseUrl: (projectId) => resolveProjectBaseUrl(token, projectId),
    project: (baseUrl, projectId) => getProjectDetails(baseUrl, token, projectId),
    folder: (baseUrl, folderId) => getFolderDetails(baseUrl, token, folderId),
    file: (baseUrl, fileId) => getFileDetails(baseUrl, token, fileId),
    items: (baseUrl, folderId) => listFolderItems(baseUrl, token, folderId),
    downloadUrl: (baseUrl, fileId, options) => getDownloadUrl(baseUrl, token, fileId, options),
  };
}

export function cuentaDeps(): CuentaDeps {
  return {
    oauth: oauthConfig(),
    renovar,
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    ahora: () => Date.now(),
  };
}

/** Today, in the company's time zone (licenses expire at the end of their last day there). */
export function hoy(): string {
  return hoyIso(new Date(), process.env.MANUALES_ZONA?.trim() || "America/Bogota");
}

function requireConfig(): ConfigManuales {
  const cfg = configManuales();
  if (!cfg) throw new ManualesError("La carpeta de manuales no está bien indicada (variable MANUALES_CARPETA).", 503, "sin-configurar");
  return cfg;
}

// ---------------------------------------------------------------- who calls

export interface Persona {
  id: string;
  email: string;
  nombre: string;
  /** Administrator of the manager project. */
  esAdmin: boolean;
}

const personas = new Map<string, { persona: Persona; expiresAt: number }>();

/**
 * The caller, from their own Trimble token: who they are (GET /users/me in
 * the region of the project they opened the app from) and whether they
 * administer the manager project. Cached a couple of minutes per token.
 */
async function identificar(token: string, projectId: string, cfg: ConfigManuales): Promise<Persona> {
  const key = `${createHash("sha256").update(token).digest("hex").slice(0, 32)}:${projectId}`;
  const hit = personas.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.persona;
  const baseUrl = await resolveProjectBaseUrl(token, projectId);
  const me = await getCurrentUser(baseUrl, token);
  const esAdmin = await resolveCaller(token, cfg.projectId).then(
    (c) => c.isAdmin,
    () => false // not a member of the manager project
  );
  const persona: Persona = {
    id: me.id,
    email: (me.email ?? "").toLowerCase(),
    nombre: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.email || me.id,
    esAdmin,
  };
  if (personas.size > 500) for (const [k, v] of personas) if (v.expiresAt <= Date.now()) personas.delete(k);
  personas.set(key, { persona, expiresAt: Date.now() + TTL_MS });
  return persona;
}

// ---------------------------------------------------------------- preambles

function errorResponse(err: unknown): Response {
  if (err instanceof ManualesError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof TrimbleApiError && err.status === 401) {
    return NextResponse.json(
      { error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir Manuales.", code: "trimble-session" },
      { status: 401 }
    );
  }
  if (err instanceof TrimbleApiError) {
    console.error("[manuales]", err.message);
    return NextResponse.json({ error: `Trimble Connect respondió con un error (${err.status}).` }, { status: 502 });
  }
  if (err instanceof StoreError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[manuales]", err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
}

export interface Llamada {
  persona: Persona;
  cfg: ConfigManuales;
  store: ManualesStore;
}

/** Common preamble: the caller's token and project, and who they are. */
export async function handle(req: NextRequest, run: (ctx: Llamada) => Promise<Response>): Promise<Response> {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>).", code: "sin-token" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isValidProjectId(projectId)) return NextResponse.json({ error: "Falta el parametro projectId o no es válido." }, { status: 400 });
  try {
    const cfg = requireConfig();
    const persona = await identificar(token, projectId, cfg);
    return await run({ persona, cfg, store: manualesStore() });
  } catch (err) {
    return errorResponse(err);
  }
}

export interface Lectura extends Llamada {
  tc: Tc;
  abierta: Abierta;
}

const abiertas = new Map<string, { abierta: Abierta; expiresAt: number }>();

/**
 * For reading the manuals: the caller must be authorized (or administer the
 * manager project); Trimble is then read with the technical account.
 */
export function handleLector(req: NextRequest, run: (ctx: Lectura) => Promise<Response>): Promise<Response> {
  return handle(req, async (ctx) => {
    const lectura = await puedeLeer(ctx.store, ctx.persona.email, async () => ctx.persona.esAdmin, hoy());
    if (!lectura.autorizado && !lectura.esAdmin) throw new ManualesError(mensajeSinAcceso(lectura), 403, "no-autorizado");
    const tc = tcCon(await tokenTecnico(ctx.store, cuentaDeps()));
    const key = `${ctx.cfg.projectId}:${ctx.cfg.folderId ?? ""}`;
    const hit = abiertas.get(key);
    let abierta = hit && hit.expiresAt > Date.now() ? hit.abierta : null;
    if (!abierta) {
      try {
        abierta = await abrirBiblioteca(tc, ctx.cfg);
      } catch (err) {
        if (err instanceof ManualesError && err.code === "sin-acceso") {
          throw new ManualesError(
            "La cuenta técnica no tiene acceso a la carpeta de manuales en MANAGER PROJECT: el administrador debe revisarla.",
            503,
            "cuenta-sin-acceso"
          );
        }
        throw err;
      }
      abiertas.set(key, { abierta, expiresAt: Date.now() + TTL_MS });
    }
    return run({ ...ctx, tc, abierta });
  });
}

/** For administering access: administrators of the manager project only. */
export function handleAdmin(req: NextRequest, run: (ctx: Llamada) => Promise<Response>): Promise<Response> {
  return handle(req, async (ctx) => {
    requireAdmin(ctx.persona.esAdmin);
    return run(ctx);
  });
}

/** Forgets the opened folder (after the account changes). */
export function olvidarBiblioteca() {
  abiertas.clear();
}

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/** A Trimble Connect id from the query string, or a 400. */
export function idParam(req: NextRequest, name: string, required: boolean): string | null {
  const value = req.nextUrl.searchParams.get(name);
  if (!value) {
    if (required) throw new ManualesError(`Falta el parámetro ${name}.`, 400, "parametro");
    return null;
  }
  if (!ID_RE.test(value)) throw new ManualesError(`El parámetro ${name} no es válido.`, 400, "parametro");
  return value;
}

/**
 * Where Trimble Identity sends the browser back after the technical account
 * signs in. It must be one of the Trimble app's registered callback URLs:
 * "apibasedatos" only has http://localhost (and external developers can't
 * edit it in Trimble's console), so by default the browser lands on a page
 * that doesn't load and the administrator pastes its address in Manuales.
 * If this app's own callback gets registered, set MANUALES_REDIRECT_URI to
 * it and the connection completes by itself.
 */
export function redirectUri(): string {
  return process.env.MANUALES_REDIRECT_URI?.trim() || "http://localhost";
}

/** This app's own callback (automatic connection) for this request's host. */
export function callbackPropio(req: NextRequest): string {
  return `${req.nextUrl.origin}/api/manuales/oauth/callback`;
}

export function conexionDeps(): ConexionDeps {
  return {
    canjear: canjearCodigo,
    revocar,
    tc: tcCon,
    usuario: getCurrentUser,
    olvidar: olvidarBiblioteca,
  };
}

export { errorResponse };

// ---------------------------------------------------------------- online sales

/** This app's public address (MANUALES_URL_PUBLICA, or the one the request came to). */
export function urlPublica(req: NextRequest): string {
  return process.env.MANUALES_URL_PUBLICA?.trim().replace(/\/+$/, "") || req.nextUrl.origin;
}

/** Where buyers come back from Mercado Pago, and where it notifies payments (only to a public https address). */
export function urlsPago(req: NextRequest): UrlsPago {
  const base = urlPublica(req);
  return {
    retorno: `${base}/api/manuales/pagos/retorno`,
    notificacion: base.startsWith("https://") ? `${base}/api/manuales/pagos/webhook?source_news=webhooks` : null,
  };
}

/** Mercado Pago with Vercel's credentials, or null when they aren't set. */
export function mercadoPagoDe(): { cfg: MpConfig; mp: Mp } | null {
  const cfg = mpConfig();
  return cfg ? { cfg, mp: mercadoPago(cfg) } : null;
}
