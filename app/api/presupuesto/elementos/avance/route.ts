import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/presupuesto/routes";
import { elementosEjecucion } from "../../../../../lib/presupuesto/servicioAvance";

export const dynamic = "force-dynamic";

/** Every linked element with the day it was built (to color the model by progress). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await elementosEjecucion(ctx)));
}
