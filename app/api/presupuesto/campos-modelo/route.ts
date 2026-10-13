import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { guardarCamposModelo } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { modelos: [...], campos: [{ key, label, group, kind, count }] }: the properties read from the models loaded in the viewer. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarCamposModelo(ctx, await readJson(req))));
}
