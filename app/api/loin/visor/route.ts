import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/loin/routes";
import { getVisor } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The models' disciplines and the objects linked by hand. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getVisor(ctx)));
}
