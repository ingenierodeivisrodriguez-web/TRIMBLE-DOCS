import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { resolveCaller } from "../propiedades/caller";
import type { Caller } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { TcExplorar } from "../publicar/explorar";
import {
  getFileDetails,
  getFolderDetails,
  getFolderPermissions,
  getProjectDetails,
  listFolderItems,
  listMyProjects,
  listProjectGroups,
  listProjectUsers,
  listRegionProjects,
  listRegions,
  PathEntry,
  ProjectDetails,
  resolveProjectBaseUrl,
  TrimbleApiError,
} from "../trimbleApi";
import { FlujoError } from "./errores";
import type { DepsPrueba } from "./prueba";
import type { Ctx, ElementoTrimble, TrimbleFlujo } from "./service";
import { flujoStore } from "./store";

export interface RouteContext {
  projectId: string;
  caller: Caller;
  tc: TcExplorar;
  prueba: DepsPrueba;
  /** For the service (phase 1 on). */
  ctx: Ctx;
}

/** A folder or file as the flow keeps it: "Proyecto / Diseño / Arquitectura" and the ids above it. */
export function elementoDe(proyecto: Pick<ProjectDetails, "rootId" | "name">, id: string, nombre: string, path: PathEntry[]): ElementoTrimble {
  if (id === proyecto.rootId) return { id, ruta: proyecto.name, ancestros: [] };
  const arriba = path.filter((p) => p.id !== id);
  const nombreDe = (p: PathEntry) => (p.id === proyecto.rootId ? proyecto.name : p.name);
  return { id, ruta: [...arriba.map(nombreDe), nombre].join(" / "), ancestros: arriba.map((p) => p.id) };
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
    let proyecto: Promise<ProjectDetails> | null = null;
    const elProyecto = () => (proyecto ??= getProjectDetails(servidor, token, projectId));
    const trimble: TrimbleFlujo = {
      async carpeta(id) {
        const [p, d] = await Promise.all([elProyecto(), getFolderDetails(servidor, token, id)]);
        if (d.projectId && d.projectId !== projectId) throw new FlujoError("Esa carpeta no es de este proyecto.", 404);
        return elementoDe(p, d.id, d.name, d.path);
      },
      async archivo(id) {
        const [p, f] = await Promise.all([elProyecto(), getFileDetails(servidor, token, id)]);
        // Its path goes up to this project's root folder; otherwise it is of another project.
        if (f.path.length && !f.path.some((x) => x.id === p.rootId)) throw new FlujoError("Ese archivo no es de este proyecto.", 404);
        return elementoDe(p, f.id, f.name, f.path);
      },
      personas: () => listProjectUsers(servidor, token, projectId),
      grupos: () => listProjectGroups(servidor, token, projectId),
      miembros: (groupId) => listProjectUsers(servidor, token, projectId, { groupId }),
      permisos: (folderId) => getFolderPermissions(servidor, token, folderId),
      items: (folderId) => listFolderItems(servidor, token, folderId),
      version: async (fileId) => (await getFileDetails(servidor, token, fileId)).versionId || null,
      crearTarea: (cuerpo) => clienteTrimble(servidor, token).pedir("POST", "/todos", { cuerpo }),
      lado: { projectId, servidor, cliente: clienteTrimble(servidor, token) },
    };
    return await run({
      projectId,
      caller,
      tc,
      // The store is opened only when used, so the phase 0 test works without the database.
      ctx: {
        projectId,
        caller,
        tc: trimble,
        get store() {
          return flujoStore();
        },
      },
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
    if (err instanceof StoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
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
