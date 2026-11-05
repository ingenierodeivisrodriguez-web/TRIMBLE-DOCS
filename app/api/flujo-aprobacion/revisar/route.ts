import { NextRequest, NextResponse } from "next/server";
import { revisarFlujo } from "../../../../lib/flujo-aprobacion/revision";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// The folder walk has a 50 s budget, plus the writes.
export const maxDuration = 120;

/** { flujoId }: walks a flow's review folders with the caller's session and registers what changed. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await revisarFlujo(ctx, await readJson(req))));
}
