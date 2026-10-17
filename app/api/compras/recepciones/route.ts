import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { getRecepciones, guardarRecepcion } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Receptions and the issued orders and contracts with what is still to receive. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getRecepciones(ctx)));
}

/** { id?, ordenId, fecha, remision, observaciones, lineas, version }: creates or changes a draft. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarRecepcion(ctx, await readJson(req))));
}
