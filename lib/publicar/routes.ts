import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { clienteTrimble } from "../compras/cde";
import { resolveCaller } from "../propiedades/caller";
import { StoreError } from "../propiedades/store";
import { canjearCodigo, oauthConfig, renovar, revocar } from "../manuales/oauth";
import { getCurrentUser, getFolderDetails, getProjectDetails, listFolderItems, listMyProjects, listRegionProjects, listRegions, resolveProjectBaseUrl, TrimbleApiError } from "../trimbleApi";
import type { DepsCopia, Lado } from "./copiar";
import { DepsCuenta, leerAdministradores, tokenTecnico } from "./cuenta";
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

/** Region-independent identity calls go to the master region. */
const MASTER = "https://app.connect.trimble.com/tc/api/2.0";

/** The technical account's settings: the Trimble app of Manuales, and PUBLICAR_ADMINS. */
export function cuentaDeps(): DepsCuenta {
  return {
    oauth: oauthConfig(),
    renovar,
    canjear: canjearCodigo,
    revocar,
    usuario: (token) => getCurrentUser(MASTER, token),
    // The Trimble app only accepts http://localhost: the administrator pastes the address it lands on.
    redirectUri: process.env.PUBLICAR_REDIRECT_URI?.trim() || "http://localhost",
    administradores: leerAdministradores(process.env.PUBLICAR_ADMINS),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    ahora: () => Date.now(),
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
    const store = publicarStore();
    // The connected account's token, read once per request (null: not connected).
    let tecnica: Promise<string | null> | null = null;
    const tokenTecnica = async () => {
      const t = await (tecnica ??= tokenTecnico(store, cuentaDeps()));
      if (!t) throw new PublicarError("No hay una cuenta conectada.", 503, "sin-cuenta");
      return t;
    };
    return await run({
      projectId,
      caller,
      store,
      deps: {
        aqui,
        abrir,
        nombreProyecto: async (id) => (await getProjectDetails(await resolveProjectBaseUrl(token, id), token, id)).name ?? "",
        tecnico: {
          cuenta: async () => {
            if (!(await (tecnica ??= tokenTecnico(store, cuentaDeps())))) return null;
            return { email: (await store.getCuenta())?.cuentaEmail || "la cuenta conectada" };
          },
          abrir: async (id) => {
            const t = await tokenTecnica();
            const s = await resolveProjectBaseUrl(t, id);
            return { projectId: id, servidor: s, cliente: clienteTrimble(s, t) };
          },
          nombreProyecto: async (id) => {
            const t = await tokenTecnica();
            return (await getProjectDetails(await resolveProjectBaseUrl(t, id), t, id)).name ?? "";
          },
        },
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
