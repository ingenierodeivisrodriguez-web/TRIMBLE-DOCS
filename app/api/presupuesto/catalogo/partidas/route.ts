import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { guardarPartidas } from "../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { partidas: [{ id, codigo, descripcion, unidad, rendimiento, jornada, omniclass, componentes }] }. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarPartidas(ctx, await readJson(req))));
}
