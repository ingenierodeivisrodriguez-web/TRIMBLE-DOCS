import { NextRequest, NextResponse } from "next/server";
import { invalidateProjectData } from "../../../../lib/cache";
import { runAnalysis } from "../../../../lib/validacion/analysisCache";
import { isConfigured } from "../../../../lib/validacion/config";
import { loadConfig } from "../../../../lib/validacion/configStore";
import { runDuplicatesAnalysis } from "../../../../lib/validacion/duplicatesCache";
import { AnalysisOverview } from "../../../../lib/validacion/types";
import { authorize, errorResponse } from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
// Each crawl step is budgeted well below this (see CRAWL_BUDGET_MS in lib/cache.ts).
export const maxDuration = 60;

/**
 * Runs (or continues) one on-demand analysis of the project: the duplicate-name
 * check always runs, and the naming-convention check runs too when the project
 * has a saved, configured template. Only ever called from the "Analizar"
 * button - there is no automatic or scheduled analysis. `refresh=1` (sent by
 * the button on its first request) discards the cached folder walk so the
 * result reflects the project as it is right now; while the walk is still
 * running this answers 202 with progress and the client keeps polling
 * without `refresh`.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  try {
    if (req.nextUrl.searchParams.get("refresh") === "1") invalidateProjectData(auth.projectId);

    // Duplicates never depend on the config, but they share the same crawl,
    // so this is what actually drives (and reports progress for) the walk.
    const duplicates = await runDuplicatesAnalysis(auth.projectId, auth.accessToken);
    if (!duplicates.done) {
      return NextResponse.json({ status: "processing", progress: duplicates.progress }, { status: 202 });
    }

    const { config, exists } = await loadConfig(auth.projectId);
    const configured = exists && isConfigured(config);

    let validation: AnalysisOverview["validation"] = null;
    if (configured) {
      // The crawl is already done (shared with the duplicates check above), so
      // this resolves immediately from cache instead of walking again.
      const outcome = await runAnalysis(auth.projectId, auth.accessToken, config);
      if (outcome.done) validation = outcome.result.summary;
    }

    const overview: AnalysisOverview = { configured, validation, duplicates: duplicates.result.summary };
    return NextResponse.json(overview);
  } catch (err) {
    return errorResponse(err);
  }
}
