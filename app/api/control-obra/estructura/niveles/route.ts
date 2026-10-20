import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarNivel } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Creates or changes a level (of the template or of this project). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarNivel(ctx, await readJson(req))));
}
