import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getPanel } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** The panel: figures, each resource's state and its path through Compras. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getPanel(ctx)));
}
