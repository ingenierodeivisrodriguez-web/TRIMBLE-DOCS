import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/compras/routes";
import { pruebaCde } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** { paso, carpetaId?, uploadId? }: one step of the CDE write test (Documentos: administrar). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pruebaCde(ctx, await readJson(req))));
}
