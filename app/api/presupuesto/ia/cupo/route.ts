import { NextRequest, NextResponse } from "next/server";
import { guardarCupoIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";

/** { proyecto?, global? }: the platform's administrators set the quotas. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarCupoIA(ctx, await readJson(req))));
}
