import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/compras/routes";
import { guardarUsuario } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** { userId, rolId, desde, hasta, activo, version }: gives, changes or revokes an access. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarUsuario(ctx, await readJson(req))));
}
