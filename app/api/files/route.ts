import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/cache";
import { TrimbleApiError } from "../../../lib/trimbleApi";
import { FilesListResponse } from "../../../lib/types";

export const dynamic = "force-dynamic";

// A single file type realistically has a few hundred files (per the product
// spec); returning the whole filtered list lets the modal sort/search
// instantly on the client without a round trip per keystroke or column
// click. This cap just guards against a pathological outlier.
const MAX_ITEMS = 5000;

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const ext = req.nextUrl.searchParams.get("ext");
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
      .sort((a, b) => (a.modifiedOn < b.modifiedOn ? 1 : -1))
      .slice(0, MAX_ITEMS);

    const response: FilesListResponse = {
      items: filtered,
      total: filtered.length,
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
