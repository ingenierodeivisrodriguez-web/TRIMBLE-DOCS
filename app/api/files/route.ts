import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/cache";
import { TrimbleApiError } from "../../../lib/trimbleApi";
import { FilesPageResponse } from "../../../lib/types";

export const dynamic = "force-dynamic";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const ext = req.nextUrl.searchParams.get("ext");
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25") || 25)
  );
  const accessToken = getBearerToken(req);

  if (!projectId || !ext) {
    return NextResponse.json({ error: "Faltan los parametros projectId y ext." }, { status: 400 });
  }
  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta el access token (header Authorization: Bearer <token>)." },
      { status: 401 }
    );
  }

  try {
    const { data } = await getProjectData(projectId, accessToken);
    const filtered = data.files
      .filter((f) => f.ext === ext)
      .sort((a, b) => (a.modifiedOn < b.modifiedOn ? 1 : -1));

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    const response: FilesPageResponse = {
      items,
      total: filtered.length,
      page,
      pageSize,
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
