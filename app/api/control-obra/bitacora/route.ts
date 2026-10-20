import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/control-obra/routes";
import { getBitacora } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The bitácora: read only, newest first. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getBitacora(ctx, req.nextUrl.searchParams)));
}
