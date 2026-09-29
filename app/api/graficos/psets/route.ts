import { NextRequest, NextResponse } from "next/server";
import { isValidLibId, isValidLink, loadLibraries, psetsForLinks } from "../../../../lib/psetApi";
import { resolvePsetApiBaseUrl, TrimbleApiError } from "../../../../lib/trimbleApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_LINKS = 60;
const MAX_LIBS = 10;

function getBearerToken(req: NextRequest): string | null {
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/**
 * Reads Trimble Connect property-set libraries for "Gráficos de Modelos" (a
 * 3D viewer extension). Called from the browser with the user's own token;
 * going through here keeps the page independent of whether the Property Set
 * Service accepts cross-origin calls (it only documents an experimental CORS
 * proxy) and resolves the project's region server-side. Only the two reads
 * the extension needs are possible - it is not a general proxy.
 *
 * Body: { projectId, op: "links", links: ["frn:entity:..."] }
 *    -> { psets }                   property sets on those objects (to discover libraries)
 *       { projectId, op: "libraries", libIds: ["..."] }
 *    -> { libs, defs, psets }       everything filled in with those libraries
 */
export async function POST(req: NextRequest) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>)." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    projectId?: unknown;
    op?: unknown;
    links?: unknown;
    libIds?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  if (!projectId) return NextResponse.json({ error: "Falta el parametro projectId." }, { status: 400 });

  try {
    const base = await resolvePsetApiBaseUrl(accessToken, projectId);

    if (body?.op === "links") {
      const links = Array.isArray(body.links) ? body.links.filter((l): l is string => typeof l === "string") : [];
      if (links.length === 0 || links.length > MAX_LINKS || !links.every(isValidLink)) {
        return NextResponse.json({ error: `Envía entre 1 y ${MAX_LINKS} enlaces frn: válidos.` }, { status: 400 });
      }
      return NextResponse.json({ psets: await psetsForLinks(base, accessToken, links) });
    }

    if (body?.op === "libraries") {
      const libIds = Array.isArray(body.libIds) ? body.libIds.filter((l): l is string => typeof l === "string") : [];
      if (libIds.length === 0 || libIds.length > MAX_LIBS || !libIds.every(isValidLibId)) {
        return NextResponse.json({ error: `Envía entre 1 y ${MAX_LIBS} identificadores de biblioteca válidos.` }, { status: 400 });
      }
      return NextResponse.json(await loadLibraries(base, accessToken, libIds));
    }

    return NextResponse.json({ error: 'El parametro op debe ser "links" o "libraries".' }, { status: 400 });
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
