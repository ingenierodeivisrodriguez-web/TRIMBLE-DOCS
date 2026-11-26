import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/inspeccion-360/routes";
import { estado } from "../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await estado(ctx)));
}
