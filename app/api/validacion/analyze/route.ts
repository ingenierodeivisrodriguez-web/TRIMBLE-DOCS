import { NextRequest, NextResponse } from "next/server";
import { invalidateProjectData } from "../../../../lib/cache";
import { runAnalysis } from "../../../../lib/validacion/analysisCache";
import { isConfigured } from "../../../../lib/validacion/config";
import { loadConfig } from "../../../../lib/validacion/configStore";
import {
  authorize,
  errorResponse,
  NOT_CONFIGURED_MESSAGE,
} from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
// Each crawl step is budgeted well below this (see CRAWL_BUDGET_MS in lib/cache.ts).
export const maxDuration = 60;

/**
 * Runs (or continues) an analysis of the project against its saved config.
 * Only ever called from the "Analizar" button - there is no automatic or
 * scheduled analysis. `refresh=1` (sent by the button on its first request)
 * discards the cached folder walk so the analysis sees the project as it is now;
 * while the walk is still running this answers 202 with progress and the
 * client keeps polling without `refresh`.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { config, exists } = await loadConfig(auth.projectId);
    if (!exists || !isConfigured(config)) {
      return NextResponse.json(
        { error: NOT_CONFIGURED_MESSAGE, code: "not-configured" },
        { status: 409 }
      );
    }

    if (req.nextUrl.searchParams.get("refresh") === "1") invalidateProjectData(auth.projectId);

    const outcome = await runAnalysis(auth.projectId, auth.accessToken, config);
    if (!outcome.done) {
      return NextResponse.json({ status: "processing", progress: outcome.progress }, { status: 202 });
    }
    return NextResponse.json(outcome.result.summary);
  } catch (err) {
    return errorResponse(err);
  }
}
