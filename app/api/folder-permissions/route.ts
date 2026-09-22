import { NextRequest, NextResponse } from "next/server";
import { AncestorRef, resolveFolderPermissions } from "../../../lib/permissions";
import { resolveProjectBaseUrl, TrimbleApiError } from "../../../lib/trimbleApi";

export const dynamic = "force-dynamic";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/**
 * Returns who has access to one folder (direct and inherited - see
 * lib/permissions.ts). `ancestors` is the folder's path from the project
 * root down to its immediate parent, as JSON `[{"id":...,"name":...}, ...]`;
 * the client already has this from the tree it rendered, so the server
 * doesn't need to look it up again.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const folderId = req.nextUrl.searchParams.get("folderId");
  const ancestorsParam = req.nextUrl.searchParams.get("ancestors");
  const accessToken = getBearerToken(req);

  if (!projectId || !folderId) {
    return NextResponse.json({ error: "Faltan los parametros projectId y folderId." }, { status: 400 });
  }
  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta el access token (header Authorization: Bearer <token>)." },
      { status: 401 }
    );
  }

  let ancestors: AncestorRef[] = [];
  if (ancestorsParam) {
    try {
      ancestors = JSON.parse(ancestorsParam);
    } catch {
      return NextResponse.json({ error: "El parametro ancestors no es JSON valido." }, { status: 400 });
    }
  }

  try {
    const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
    const result = await resolveFolderPermissions(baseUrl, accessToken, projectId, folderId, ancestors);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
