import { NextRequest, NextResponse } from "next/server";
import { assertProjectAccess, getBearerToken, isValidProjectId } from "../access";
import { TrimbleApiError } from "../trimbleApi";
import { ConfigStoreError } from "./configStore";

export interface AuthorizedRequest {
  projectId: string;
  accessToken: string;
}

/**
 * Common preamble of every Validación API route: needs a projectId and the
 * caller's Trimble access token, and checks that token belongs to a member of
 * that project. Returns a ready-made error response when something is wrong.
 */
export async function authorize(req: NextRequest): Promise<AuthorizedRequest | NextResponse> {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isValidProjectId(projectId)) {
    return NextResponse.json({ error: "Falta el parametro projectId o no es válido." }, { status: 400 });
  }
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta el access token (header Authorization: Bearer <token>)." },
      { status: 401 }
    );
  }
  try {
    await assertProjectAccess(accessToken, projectId);
  } catch (err) {
    return errorResponse(err);
  }
  return { projectId, accessToken };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof TrimbleApiError || err instanceof ConfigStoreError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Error desconocido.";
  return NextResponse.json({ error: message }, { status: 500 });
}
