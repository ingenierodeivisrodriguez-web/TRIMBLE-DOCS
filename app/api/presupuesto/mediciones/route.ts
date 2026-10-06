import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { guardarMedicion } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { itemId, campo, campoLabel, unidad }: what a partida adds up from its elements (campo null: nothing). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarMedicion(ctx, await readJson(req))));
}
