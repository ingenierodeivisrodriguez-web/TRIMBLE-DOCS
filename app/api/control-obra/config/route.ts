import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { guardarConfig } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The project's settings. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarConfig(ctx, await readJson(req))));
}
