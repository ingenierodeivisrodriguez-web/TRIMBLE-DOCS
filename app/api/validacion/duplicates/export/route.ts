import { NextRequest, NextResponse } from "next/server";
import { duplicatesTable, toCsv, toXlsx } from "../../../../../lib/validacion/exportFile";
import { filterDuplicateGroups } from "../../../../../lib/validacion/duplicates";
import { runDuplicatesAnalysis } from "../../../../../lib/validacion/duplicatesCache";
import { authorize, errorResponse } from "../../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Downloads every duplicate-name group (one row per copy) as .xlsx or .csv, with the same filters the table is showing. */
export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  const params = req.nextUrl.searchParams;
  const format = params.get("format");
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json({ error: "El parametro format debe ser xlsx o csv." }, { status: 400 });
  }

  try {
    const outcome = await runDuplicatesAnalysis(auth.projectId, auth.accessToken);
    if (!outcome.done) {
      return NextResponse.json({ status: "processing", progress: outcome.progress }, { status: 202 });
    }

    const groups = filterDuplicateGroups(outcome.result.groups, {
      ext: params.get("ext") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    const table = duplicatesTable(groups);
    const date = new Date().toISOString().slice(0, 10);
    const baseName = `validacion-duplicados-${date}`;

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
