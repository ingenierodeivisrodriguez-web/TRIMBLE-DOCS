import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { guardarOmniclass } from "../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { entradas: [{ codigo, titulo }] }: imports OmniClass codes. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarOmniclass(ctx, await readJson(req))));
}
