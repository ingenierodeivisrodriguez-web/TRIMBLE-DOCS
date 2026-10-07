import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "../access";
import {
  getDownloadUrl,
  getFileDetails,
  getFolderDetails,
  getProjectDetails,
  listFolderItems,
  resolveProjectBaseUrl,
  TrimbleApiError,
} from "../trimbleApi";
import { configManuales } from "./config";
import { Abierta, abrirBiblioteca, ManualesError, Tc } from "./service";

export interface RouteContext {
  tc: Tc;
  abierta: Abierta;
}

const TTL_MS = 2 * 60 * 1000;
const abiertas = new Map<string, { abierta: Abierta; expiresAt: number }>();

/** Trimble Connect through the caller's token. */
function tcCon(token: string): Tc {
  return {
    baseUrl: (projectId) => resolveProjectBaseUrl(token, projectId),
    project: (baseUrl, projectId) => getProjectDetails(baseUrl, token, projectId),
    folder: (baseUrl, folderId) => getFolderDetails(baseUrl, token, folderId),
    file: (baseUrl, fileId) => getFileDetails(baseUrl, token, fileId),
    items: (baseUrl, folderId) => listFolderItems(baseUrl, token, folderId),
    downloadUrl: (baseUrl, fileId, options) => getDownloadUrl(baseUrl, token, fileId, options),
  };
}

/**
 * Common preamble of the Manuales API: the caller's Trimble token and the
 * manuals folder opened with it (cached a couple of minutes per token).
 * Errors become JSON with a code: "sin-configurar", "sin-acceso",
 * "trimble-session"...
 */
export async function handle(req: NextRequest, run: (ctx: RouteContext) => Promise<Response>): Promise<Response> {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>).", code: "sin-token" }, { status: 401 });
  const cfg = configManuales();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "Falta indicar la carpeta de manuales: en Vercel agrega la variable MANUALES_CARPETA con el enlace de la carpeta de \"MANAGER PROJECT\" y vuelve a desplegar.",
        code: "sin-configurar",
      },
      { status: 503 }
    );
  }
  try {
    const tc = tcCon(token);
    const key = `${createHash("sha256").update(token).digest("hex").slice(0, 32)}:${cfg.projectId}:${cfg.folderId ?? ""}`;
    const now = Date.now();
    const hit = abiertas.get(key);
    let abierta = hit && hit.expiresAt > now ? hit.abierta : null;
    if (!abierta) {
      abierta = await abrirBiblioteca(tc, cfg);
      if (abiertas.size > 500) for (const [k, v] of abiertas) if (v.expiresAt <= now) abiertas.delete(k);
      abiertas.set(key, { abierta, expiresAt: now + TTL_MS });
    }
    return await run({ tc, abierta });
  } catch (err) {
    if (err instanceof ManualesError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    if (err instanceof TrimbleApiError && err.status === 401) {
      console.error("[manuales] Trimble Connect rechazó el token:", err.message);
      return NextResponse.json(
        { error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir Manuales.", code: "trimble-session" },
        { status: 401 }
      );
    }
    if (err instanceof TrimbleApiError) {
      console.error("[manuales]", err.message);
      return NextResponse.json({ error: `Trimble Connect respondió con un error (${err.status}).` }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
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
