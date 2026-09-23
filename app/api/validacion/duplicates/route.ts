import { NextRequest, NextResponse } from "next/server";
import { runDuplicatesAnalysis } from "../../../../lib/validacion/duplicatesCache";
import { filterDuplicateGroups } from "../../../../lib/validacion/duplicates";
import { authorize, errorResponse } from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PAGE_SIZE = 100;

/**
 * One page of the last duplicate-name analysis, optionally filtered by
 * extension / free text (name or folder). Never requires a saved config.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 25));

  try {
    const outcome = await runDuplicatesAnalysis(auth.projectId, auth.accessToken);
    if (!outcome.done) {
      return NextResponse.json({ status: "processing", progress: outcome.progress }, { status: 202 });
    }

    const groups = filterDuplicateGroups(outcome.result.groups, {
      ext: params.get("ext") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    const start = (page - 1) * pageSize;
    return NextResponse.json({
      items: groups.slice(start, start + pageSize),
      total: groups.length,
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
