import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getInsumos } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** The resources planned in the project's budget, with where each one is used (Insumos: ver). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getInsumos(ctx)));
}
