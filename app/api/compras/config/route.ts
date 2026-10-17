import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { guardarConfig } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** { toleranciaPct, version }: the tolerance over the planned quantities (Accesos y roles: administrar). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarConfig(ctx, await readJson(req))));
}
