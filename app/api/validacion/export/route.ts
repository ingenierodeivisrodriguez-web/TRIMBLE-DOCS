import { NextRequest, NextResponse } from "next/server";
import { runAnalysis } from "../../../../lib/validacion/analysisCache";
import { loadConfig } from "../../../../lib/validacion/configStore";
import { selectRows } from "../../../../lib/validacion/select";
import { tableFor, toCsv, toXlsx } from "../../../../lib/validacion/exportFile";
import { authorize, errorResponse } from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Downloads every row of the non-conforming (or unclassified) list as .xlsx or .csv,
 * with the same filters the results table is showing.
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const tab = params.get("tab");
  const format = params.get("format");
  if (tab !== "nonconforming" && tab !== "unclassified") {
    return NextResponse.json({ error: "El parametro tab debe ser nonconforming o unclassified." }, { status: 400 });
  }
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json({ error: "El parametro format debe ser xlsx o csv." }, { status: 400 });
  }

  try {
    const { config } = await loadConfig(auth.projectId);
    const outcome = await runAnalysis(auth.projectId, auth.accessToken, config);
    if (!outcome.done) {
      return NextResponse.json({ status: "processing", progress: outcome.progress }, { status: 202 });
    }

    const table = tableFor(selectRows(tab, outcome.result, params));
    const date = new Date().toISOString().slice(0, 10);
    const baseName = `validacion-${tab === "nonconforming" ? "no-conformes" : "sin-clasificar"}-${date}`;

    if (format === "csv") {
      return new NextResponse(toCsv(table), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.csv"`,
        },
      });
    }
    return new NextResponse(await toXlsx(table), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
