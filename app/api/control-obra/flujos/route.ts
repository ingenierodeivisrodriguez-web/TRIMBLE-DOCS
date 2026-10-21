import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { getFlujos, guardarFlujo } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The project's approval flows. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getFlujos(ctx)));
}

/** Saves the flow of one kind of document. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarFlujo(ctx, await readJson(req))));
}
