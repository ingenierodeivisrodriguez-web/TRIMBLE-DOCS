import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { guardarElementos } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { itemId, upsert: [{ ifcGuid, modelId, cantidad }], remove: [ifcGuid] }: links or unlinks model elements. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarElementos(ctx, await readJson(req))));
}
