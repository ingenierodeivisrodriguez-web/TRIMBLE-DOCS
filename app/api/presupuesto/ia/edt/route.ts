import { NextRequest, NextResponse } from "next/server";
import { generarEdtIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
// The browser sends small batches (about 5 partidas) so each answer fits in a function call.
export const maxDuration = 60;

/** { contexto, partidas }: proposes the EDT dictionary of a batch; saved as drafts. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await generarEdtIA(ctx, await readJson(req))));
}
