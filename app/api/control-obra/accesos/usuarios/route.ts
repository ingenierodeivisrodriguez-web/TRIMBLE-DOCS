import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarUsuario } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Activates or deactivates a person in the whole company. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarUsuario(ctx, await readJson(req))));
}
