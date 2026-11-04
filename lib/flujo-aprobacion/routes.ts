import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { resolveCaller } from "../propiedades/caller";
import type { Caller } from "../propiedades/service";
import type { TcExplorar } from "../publicar/explorar";
import {
  getFolderDetails,
  getProjectDetails,
  listFolderItems,
  listMyProjects,
  listProjectGroups,
  listProjectUsers,
  listRegionProjects,
  listRegions,
  resolveProjectBaseUrl,
  TrimbleApiError,
} from "../trimbleApi";
import { FlujoError } from "./errores";
import type { DepsPrueba } from "./prueba";

export interface RouteContext {
  projectId: string;
  caller: Caller;
  tc: TcExplorar;
  prueba: DepsPrueba;
}

/**
 * Runs a request of "Flujo de aprobación": checks `?projectId=` and the Bearer
 * token, resolves who is calling and turns errors into `{ error, code }` JSON.
 * Everything in Trimble happens with the caller's own permissions.
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
    const [caller, servidor] = await Promise.all([resolveCaller(token, projectId), resolveProjectBaseUrl(token, projectId)]);
    const tc: TcExplorar = {
      proyectos: () => listMyProjects(token),
      regiones: () => listRegions(token),
      proyectosDeRegion: (baseUrl) => listRegionProjects(baseUrl, token),
      baseUrl: (id) => resolveProjectBaseUrl(token, id),
      proyecto: (baseUrl, id) => getProjectDetails(baseUrl, token, id),
      carpeta: (baseUrl, folderId) => getFolderDetails(baseUrl, token, folderId),
      items: (baseUrl, folderId) => listFolderItems(baseUrl, token, folderId),
    };
    return await run({
      projectId,
      caller,
      tc,
      prueba: {
        projectId,
        lado: { projectId, servidor, cliente: clienteTrimble(servidor, token) },
        yo: caller.id,
        personas: (groupId) => listProjectUsers(servidor, token, projectId, groupId ? { groupId } : {}),
        grupos: () => listProjectGroups(servidor, token, projectId),
      },
    });
  } catch (err) {
    if (err instanceof FlujoError) {
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
    console.error("[flujo-aprobacion]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado." }, { status: 500 });
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new FlujoError("El cuerpo de la solicitud no es JSON válido.");
  }
}
