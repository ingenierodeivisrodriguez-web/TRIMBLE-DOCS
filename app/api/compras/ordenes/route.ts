import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { getOrdenes, guardarOrden } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Purchase orders and contracts the caller can see, their revisions and the chosen suppliers still to order. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getOrdenes(ctx)));
}

/** { id?, tipo, requisicionId, fechaEntrega, ..., lineas, version }: creates or changes a draft. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarOrden(ctx, await readJson(req))));
}
