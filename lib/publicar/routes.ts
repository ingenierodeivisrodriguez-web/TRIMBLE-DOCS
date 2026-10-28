import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { resolveCaller } from "../propiedades/caller";
import { StoreError } from "../propiedades/store";
import { getFolderDetails, getProjectDetails, listFolderItems, listMyProjects, listRegionProjects, listRegions, resolveProjectBaseUrl, TrimbleApiError } from "../trimbleApi";
import type { DepsCopia, Lado } from "./copiar";
import { PublicarError } from "./errores";
import type { TcExplorar } from "./explorar";
import type { Ctx } from "./service";
import { publicarStore } from "./store";

export interface RouteContext extends Ctx {
  tc: TcExplorar;
  copia: DepsCopia;
}

/** Trimble Connect through the user's token. */
function tcCon(token: string): TcExplorar {
  return {
    proyectos: () => listMyProjects(token),
    regiones: () => listRegions(token),
    proyectosDeRegion: (baseUrl) => listRegionProjects(baseUrl, token),
    baseUrl: (projectId) => resolveProjectBaseUrl(token, projectId),
    proyecto: (baseUrl, projectId) => getProjectDetails(baseUrl, token, projectId),
    carpeta: (baseUrl, folderId) => getFolderDetails(baseUrl, token, folderId),
    items: (baseUrl, folderId) => listFolderItems(baseUrl, token, folderId),
  };
}

/**
 * Runs a request of "Publicar entre proyectos": checks `?projectId=` and the
 * Bearer token, confirms the caller belongs to that project (and whether
 * they administer it) and turns errors into `{ error, code }` JSON.
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
    const aqui: Lado = { projectId, servidor, cliente: clienteTrimble(servidor, token) };
    const abrir = async (id: string): Promise<Lado> => {
      const s = await resolveProjectBaseUrl(token, id);
      return { projectId: id, servidor: s, cliente: clienteTrimble(s, token) };
    };
    return await run({
      projectId,
      caller,
      store: publicarStore(),
      deps: {
        aqui,
        abrir,
        nombreProyecto: async (id) => (await getProjectDetails(await resolveProjectBaseUrl(token, id), token, id)).name ?? "",
      },
      tc: tcCon(token),
      copia: { origen: aqui, destino: abrir },
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
    if (err instanceof StoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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
