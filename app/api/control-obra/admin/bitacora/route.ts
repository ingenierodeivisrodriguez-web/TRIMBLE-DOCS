import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/control-obra/routes";
import { getBitacoraAdmin } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Technical administrator: the bitácora of a company, or the technical administrator's own chain. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getBitacoraAdmin(ctx, req.nextUrl.searchParams)));
}
