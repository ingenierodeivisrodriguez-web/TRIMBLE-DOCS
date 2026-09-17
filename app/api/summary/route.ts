import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/cache";
import { buildSummary } from "../../../lib/summary";
import { TrimbleApiError } from "../../../lib/trimbleApi";

export const dynamic = "force-dynamic";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

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
    const { data, cached } = await getProjectData(projectId, accessToken);
    const summary = buildSummary(data.project, data.files, cached);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
