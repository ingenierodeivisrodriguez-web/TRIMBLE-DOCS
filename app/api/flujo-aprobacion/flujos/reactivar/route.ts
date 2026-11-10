import { NextRequest, NextResponse } from "next/server";
import { reactivarFlujo } from "../../../../../lib/flujo-aprobacion/reactivar";
import { handle, readJson } from "../../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// Reactivating reads the flow's files in Trimble again before the new versions enter.
export const maxDuration = 120;

/** { id, version }: brings the newer versions of a flow's files in, from the first step (its creator or an administrator). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await reactivarFlujo(ctx, await readJson(req))));
}
