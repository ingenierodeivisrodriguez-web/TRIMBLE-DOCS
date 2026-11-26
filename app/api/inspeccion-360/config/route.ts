import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/inspeccion-360/routes";
import { guardarConfig } from "../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarConfig(ctx, await readJson(req))));
}
