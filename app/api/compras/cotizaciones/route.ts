import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { getCotizaciones, guardarCotizacion } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Approved requisitions with their quotations and comparisons (Cotizaciones: ver). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getCotizaciones(ctx)));
}

/** { id?, requisicionId, proveedorId, fecha, vigenciaHasta, ..., lineas, version }: registers or corrects a quotation. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarCotizacion(ctx, await readJson(req))));
}
