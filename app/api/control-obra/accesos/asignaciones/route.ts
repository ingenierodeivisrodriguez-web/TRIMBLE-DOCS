import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarAsignacion } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Gives, changes or revokes one person's role in this project. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarAsignacion(ctx, await readJson(req))));
}
