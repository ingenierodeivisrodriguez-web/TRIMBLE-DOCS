import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { guardarInsumos } from "../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { insumos: [{ id, codigo, descripcion, unidad, precio, tipo, iu, omniclass }] }: creates or updates. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarInsumos(ctx, await readJson(req))));
}
