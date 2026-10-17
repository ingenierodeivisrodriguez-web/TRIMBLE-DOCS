import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../../lib/compras/routes";
import { anularCotizacion } from "../../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** { motivo, version }: cancels a quotation while its comparison is open. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await anularCotizacion(ctx, id, await readJson(req))));
}
