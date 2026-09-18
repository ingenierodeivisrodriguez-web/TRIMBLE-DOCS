import { NextRequest, NextResponse } from "next/server";
import { runAnalysis } from "../../../../lib/validacion/analysisCache";
import { loadConfig } from "../../../../lib/validacion/configStore";
import { selectRows } from "../../../../lib/validacion/select";
import { authorize, errorResponse } from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PAGE_SIZE = 100;

/**
 * One page of the last analysis: the non-conforming files, or the unclassified ones,
 * optionally filtered by template / field / ext / q (free text).
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const tab = params.get("tab");
  if (tab !== "nonconforming" && tab !== "unclassified") {
    return NextResponse.json({ error: "El parametro tab debe ser nonconforming o unclassified." }, { status: 400 });
  }
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 25));

  try {
    const { config } = await loadConfig(auth.projectId);
    const outcome = await runAnalysis(auth.projectId, auth.accessToken, config);
    if (!outcome.done) {
      return NextResponse.json({ status: "processing", progress: outcome.progress }, { status: 202 });
    }

    const { rows } = selectRows(tab, outcome.result, params);
    const start = (page - 1) * pageSize;
    return NextResponse.json({
      items: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
