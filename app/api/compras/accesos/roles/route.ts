import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/compras/routes";
import { guardarRol } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** { id?, nombre, descripcion, permisos, activo, version }: creates or changes a role. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarRol(ctx, await readJson(req))));
}
