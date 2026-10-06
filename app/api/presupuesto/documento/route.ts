import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { getDocumento, guardarDocumento } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** The project's budget (an empty one until it is first saved). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getDocumento(ctx)));
}

/** { doc, version }: saves the budget if nobody saved it since `version`; answers 409 otherwise. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarDocumento(ctx, await readJson(req))));
}
