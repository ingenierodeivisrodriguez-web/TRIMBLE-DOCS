import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { resolveCaller } from "../propiedades/caller";
import { ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import { getProjectDetails, resolveProjectBaseUrl, TrimbleApiError } from "../trimbleApi";
import { Ctx, DepsI360, traducir } from "./service";
import { i360Store } from "./store";

export interface RouteContext extends Ctx {
  /** The caller's Trimble Connect token, for routes that read or write the CDE. */
  accessToken: string;
}

function depsDe(accessToken: string, projectId: string): DepsI360 {
  return {
    async cde() {
      const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
      const proyecto = await getProjectDetails(baseUrl, accessToken, projectId);
      return { cliente: clienteTrimble(baseUrl, accessToken), rootId: proyecto.rootId };
    },
    async enviar(url, datos) {
      // A Blob without a type: no Content-Type header, as Trimble's signed URL expects. A 60 MB
      // photo gets three minutes.
      const res = await fetch(url, { method: "PUT", body: new Blob([datos as BlobPart]), signal: AbortSignal.timeout(180_000) });
      return res.status;
    },
  };
}

/**
 * Common preamble of every Inspección 360° API route: a valid projectId, the caller's Trimble
 * token, proof they belong to the project, and the store. Errors become JSON with their status.
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
    return await run({ projectId, caller, store: i360Store(), deps: depsDe(accessToken, projectId), accessToken });
  } catch (raw) {
    const err = traducir(raw);
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof TrimbleApiError && err.status === 401) {
      console.error("[inspeccion-360] Trimble Connect rechazó el token:", err.message);
      return NextResponse.json(
        { error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir Inspección 360°.", code: "trimble-session" },
        { status: 401 }
      );
    }
    if (err instanceof StoreError || err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[inspeccion-360]", err);
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
