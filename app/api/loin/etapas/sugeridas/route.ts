import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/loin/routes";
import { cargarEtapasSugeridas } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** Adds the usual stages the project does not have yet. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await cargarEtapasSugeridas(ctx)));
}
