import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/presupuesto/routes";
import { getResumen } from "../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** How each partida measures its elements, and how many it has (with the sum of their quantities). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getResumen(ctx)));
}
