import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/loin/routes";
import { getEstado } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The project's configuration and what the caller can do. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstado(ctx)));
}
