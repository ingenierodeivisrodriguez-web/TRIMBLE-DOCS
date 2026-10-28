import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { resolveCaller } from "../propiedades/caller";
import { ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import { TrimbleApiError } from "../trimbleApi";
import { Ctx, traducir } from "./service";
import { raStore } from "./store";

export interface RouteContext extends Ctx {
  /** The caller's Trimble Connect token, for routes that read Trimble data (the IFC). */
  accessToken: string;
}

/**
 * Common preamble of every Realidad aumentada API route: a valid projectId,
 * the caller's Trimble token, proof they belong to the project, and the
 * store. Errors become JSON responses with the right status.
 */
export async function handle(req: NextRequest, run: (ctx: RouteContext) => Promise<Response>): Promise<Response> {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isValidProjectId(projectId)) {
    return NextResponse.json({ error: "Falta el parametro projectId o no es válido." }, { status: 400 });
  }
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>)." }, { status: 401 });
  }
  try {
    const caller = await resolveCaller(accessToken, projectId);
    return await run({ projectId, caller, store: raStore(), accessToken });
  } catch (raw) {
    const err = traducir(raw);
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof TrimbleApiError && err.status === 401) {
      console.error("[ra] Trimble Connect rechazó el token:", err.message);
      return NextResponse.json(
        {
          error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir Realidad aumentada.",
          code: "trimble-session",
        },
        { status: 401 }
      );
    }
    if (err instanceof StoreError || err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}

/** The request's JSON body, or a 400 if it isn't JSON. */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ServiceError("El cuerpo de la solicitud no es JSON válido.", 400);
  }
}
