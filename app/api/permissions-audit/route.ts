import { NextRequest, NextResponse } from "next/server";
import { advancePermissionAudit, invalidatePermissionAudit } from "../../../lib/cache";
import { TrimbleApiError } from "../../../lib/trimbleApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/**
 * Runs (or continues) a permission audit of the project: every folder with
 * direct (non-inherited) permissions, flagging ones open to the whole
 * project and users with FULL_ACCESS granted directly. Only ever called from
 * the "Ejecutar auditoria" button - see components/permissionAudit. Builds
 * on the same cached folder crawl as "Resumen" and "Estructura de Carpetas"
 * (lib/cache.ts), so opening this tab after either of those costs nothing
 * extra for the folder walk itself. `refresh=1` (sent on the button's first
 * request) discards a previous audit so it re-checks every folder.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const accessToken = getBearerToken(req);

  if (!projectId) {
    return NextResponse.json({ error: "Falta el parametro projectId." }, { status: 400 });
  }
  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta el access token (header Authorization: Bearer <token>)." },
      { status: 401 }
    );
  }

  if (req.nextUrl.searchParams.get("refresh") === "1") invalidatePermissionAudit(projectId);

  try {
    const result = await advancePermissionAudit(projectId, accessToken);
    if (!result.done) {
      return NextResponse.json({ status: "processing", progress: result.progress }, { status: 202 });
    }
    return NextResponse.json({ results: result.results });
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
