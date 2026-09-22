import { NextRequest, NextResponse } from "next/server";
import { advanceProjectData } from "../../../lib/cache";
import { buildTree } from "../../../lib/folderTree";
import { TrimbleApiError } from "../../../lib/trimbleApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/**
 * Serves the "Estructura de Carpetas" tab. Reuses the exact same cached
 * crawl as /api/summary (lib/cache.ts) instead of walking the project again,
 * so folder/file counts always match the "Resumen" dashboard and switching
 * tabs after Resumen has already loaded is effectively instant. Follows the
 * same 202-while-crawling contract as /api/summary and /api/files.
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

  try {
    const result = await advanceProjectData(projectId, accessToken);
    if (!result.done) {
      return NextResponse.json({ status: "processing", progress: result.progress }, { status: 202 });
    }
    const root = buildTree(result.data.folders, result.data.files);
    return NextResponse.json({ project: result.data.project, root });
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
