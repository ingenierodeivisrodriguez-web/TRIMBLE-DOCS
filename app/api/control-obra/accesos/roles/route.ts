import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarRol } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Creates or changes a role of the company. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarRol(ctx, await readJson(req))));
}
