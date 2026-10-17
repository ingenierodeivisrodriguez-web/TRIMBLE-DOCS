import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getEstado } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Who is calling and their access to Compras in this project (null: none). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstado(ctx)));
}
