import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { getAvance, guardarAvance } from "../../../../lib/presupuesto/servicioAvance";

export const dynamic = "force-dynamic";

/** The progress reports (cortes), the baselines and the one in force with its rows. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAvance(ctx)));
}

/** { avance, version }: saves the progress reports if nobody saved them since `version`; answers 409 otherwise. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarAvance(ctx, await readJson(req))));
}
