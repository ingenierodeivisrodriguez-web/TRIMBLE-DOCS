import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, isValidProjectId } from "../access";
import { lecturaCompras } from "../lecturas/compras";
import { lecturaPresupuesto } from "../lecturas/presupuesto";
import { hoyIso } from "../manuales/licencia";
import { projectContacts, resolveCaller } from "../propiedades/caller";
import { ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import { getProjectDetails, resolveProjectBaseUrl, TrimbleApiError } from "../trimbleApi";
import { Ctx, traducir } from "./service";
import { obraStore } from "./store";

/**
 * The technical administrators of the product: Trimble user ids in the
 * CONTROL_OBRA_ADMINS variable of Vercel (comma or space separated). Never a
 * button: only whoever controls the deployment can name them.
 */
export function esAdminTecnico(userId: string, lista = process.env.CONTROL_OBRA_ADMINS ?? ""): boolean {
  return lista
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .includes(userId);
}

/**
 * Common preamble of every Control de Obra API route: a valid projectId, the
 * caller's Trimble token and proof they belong to the project (the identity is
 * the Trimble user, checked against Trimble Connect; there is no Supabase Auth).
 * The company, its license and what the person may do are then read by the
 * service on every request; the browser never says which company it is.
 */
export async function handle(req: NextRequest, run: (ctx: Ctx) => Promise<NextResponse>): Promise<NextResponse> {
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
    return await run({
      projectId,
      caller,
      esAdminTecnico: esAdminTecnico(caller.id),
      store: obraStore(),
      lecturas: { presupuesto: lecturaPresupuesto(), compras: lecturaCompras() },
      hoy: hoyIso(),
      deps: {
        contactos: () => projectContacts(accessToken, projectId),
        projectName: async () => {
          const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
          return (await getProjectDetails(baseUrl, accessToken, projectId)).name ?? "";
        },
      },
    });
  } catch (raw) {
    const err = traducir(raw);
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof TrimbleApiError && err.status === 401) {
      console.error("[control-obra] Trimble Connect rechazó el token:", err.message);
      return NextResponse.json(
        {
          error: "Trimble Connect no aceptó tu sesión (token vencido o no válido). Recarga Trimble Connect (F5) y vuelve a abrir Control de Obra.",
          code: "trimble-session",
        },
        { status: 401 }
      );
    }
    if (err instanceof TrimbleApiError && err.status === 404) {
      return NextResponse.json({ error: "No eres miembro de este proyecto en Trimble Connect.", code: "no-miembro" }, { status: 403 });
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
