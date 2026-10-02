import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { TrimbleApiError } from "../trimbleApi";
import { resolveCaller } from "./caller";
import { Caller, ServiceError } from "./service";
import { PropertiesStore, propertiesStore, StoreError } from "./store";

export interface RouteContext {
  projectId: string;
  caller: Caller;
  store: PropertiesStore;
}

/**
 * Common preamble of every Propiedades API route: a valid projectId, the
 * caller's Trimble token, proof they belong to the project, and the store.
 * Errors become JSON responses with the right status.
 */
export async function handle(
  req: NextRequest,
  run: (ctx: RouteContext) => Promise<NextResponse>
): Promise<NextResponse> {
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
    return await run({ projectId, caller, store: propertiesStore() });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
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
