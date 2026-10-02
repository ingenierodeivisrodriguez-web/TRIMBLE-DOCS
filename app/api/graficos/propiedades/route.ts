import { NextRequest, NextResponse } from "next/server";
import { assertProjectAccess, getBearerToken, isValidProjectId } from "../../../../lib/access";
import { PropiedadesUnavailable, readPropiedadesPage } from "../../../../lib/graficos/propiedadesServer";
import { TrimbleApiError } from "../../../../lib/trimbleApi";

export const dynamic = "force-dynamic";

/**
 * The "Propiedades" app's attributes for "Gráficos de Modelos" (a 3D viewer
 * extension): GET ?projectId=...&offset=... -> { definitions (first page
 * only), values: [{ ifcGuid, attributeId, value }], total, next }. Read-only,
 * and only for members of the project (checked with their Trimble token).
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ error: "Falta el parametro projectId o no es válido." }, { status: 400 });
  }
  const offsetParam = req.nextUrl.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "offset debe ser un número entero mayor o igual a 0." }, { status: 400 });
  }
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "Falta el access token (header Authorization: Bearer <token>)." }, { status: 401 });
  }

  try {
    await assertProjectAccess(accessToken, projectId);
    return NextResponse.json(await readPropiedadesPage(projectId, offset));
  } catch (err) {
    if (err instanceof PropiedadesUnavailable || err instanceof TrimbleApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
