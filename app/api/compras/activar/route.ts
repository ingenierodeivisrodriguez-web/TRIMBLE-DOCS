import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { activar } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Turns Compras on in the project: only a Trimble administrator, only while it has no administrator. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await activar(ctx)));
}
