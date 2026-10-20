import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/control-obra/routes";
import { verificarBitacoraAdmin } from "../../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Technical administrator: recomputes a chain. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await verificarBitacoraAdmin(ctx, req.nextUrl.searchParams)));
}
