import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { marcarEjecutados, resumenEjecucion } from "../../../../../lib/presupuesto/servicioAvance";

export const dynamic = "force-dynamic";

/** ?hasta=YYYY-MM-DD: by partida, its elements and those built by that day. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await resumenEjecucion(ctx, req.nextUrl.searchParams.get("hasta"))));
}

/** { marcas: [{ itemId, ifcGuid }], fecha }: marks elements as built that day (null: not built). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await marcarEjecutados(ctx, await readJson(req))));
}
