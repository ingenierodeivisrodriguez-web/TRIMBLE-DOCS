import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/compras/routes";
import { guardarTiposDocumento } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** { tipos, version }: the kinds of legal documents of suppliers (Documentos: administrar). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarTiposDocumento(ctx, await readJson(req))));
}
