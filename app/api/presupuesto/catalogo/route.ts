import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/presupuesto/routes";
import { getCatalogo } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** The catalogs (insumos, partidas, OmniClass codes) of the project's base. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getCatalogo(ctx)));
}
