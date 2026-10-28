import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { getFolderDetails, getProjectDetails, listFolderItems, listMyProjects, resolveProjectBaseUrl, TrimbleApiError } from "../trimbleApi";
import { PublicarError } from "./errores";
import type { TcExplorar } from "./explorar";
import type { DepsPrueba } from "./prueba";

export interface RouteContext {
  projectId: string;
  tc: TcExplorar;
  prueba: DepsPrueba;
}

/** Trimble Connect through the user's token. */
function tcCon(token: string): TcExplorar {
  return {
    proyectos: () => listMyProjects(token),
    baseUrl: (projectId) => resolveProjectBaseUrl(token, projectId),
    proyecto: (baseUrl, projectId) => getProjectDetails(baseUrl, token, projectId),
    carpeta: (baseUrl, folderId) => getFolderDetails(baseUrl, token, folderId),
    items: (baseUrl, folderId) => listFolderItems(baseUrl, token, folderId),
  };
}

/**
 * Runs a request of "Publicar entre proyectos": checks `?projectId=` and the
 * Bearer token, confirms the caller belongs to that project (the region
 * lookup fails otherwise) and turns errors into `{ error, code }` JSON.
 * Everything else happens with the caller's own Trimble permissions.
 */
export async function handle(req: NextRequest, run: (ctx: RouteContext) => Promise<NextResponse>): Promise<NextResponse> {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isValidProjectId(projectId)) {
    return NextResponse.json({ error: "Falta el parametro projectId o no es válido." }, { status: 400 });
  }
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>)." }, { status: 401 });
  }
  try {
    const servidor = await resolveProjectBaseUrl(token, projectId);
    return await run({
      projectId,
      tc: tcCon(token),
      prueba: {
        origen: { projectId, servidor, cliente: clienteTrimble(servidor, token) },
        destino: async (id) => {
          const s = await resolveProjectBaseUrl(token, id);
          return { projectId: id, servidor: s, cliente: clienteTrimble(s, token) };
        },
      },
    });
  } catch (err) {
    if (err instanceof PublicarError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof TrimbleApiError && err.status === 401) {
      return NextResponse.json(
        { error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir la extensión.", code: "trimble-session" },
        { status: 401 }
      );
    }
    if (err instanceof TrimbleApiError && (err.status === 403 || err.status === 404)) {
      return NextResponse.json({ error: err.status === 404 ? "No existe o no tienes acceso en Trimble Connect." : "Trimble Connect negó el acceso con tu usuario.", code: "trimble-acceso" }, { status: err.status });
    }
    console.error("[publicar]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado." }, { status: 500 });
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new PublicarError("El cuerpo de la solicitud no es JSON válido.");
  }
}
