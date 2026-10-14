import { NextRequest, NextResponse } from "next/server";
import { getEstadoIA } from "../../../../lib/presupuesto/ia/servicio";
import { handle } from "../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";

/** The assistant's state for this project: availability, quota, usage log and draft summary. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstadoIA(ctx)));
}
