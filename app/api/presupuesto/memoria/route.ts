import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/presupuesto/routes";
import { pedirActualizacionMemoria } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** Asks the viewer panel to update the memoria de cantidades of every partida; answers the model to open the viewer with. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pedirActualizacionMemoria(ctx)));
}
