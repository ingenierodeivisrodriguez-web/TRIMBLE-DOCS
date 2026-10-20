import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarNodo } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Creates or changes a value of a level in this project. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarNodo(ctx, await readJson(req))));
}
