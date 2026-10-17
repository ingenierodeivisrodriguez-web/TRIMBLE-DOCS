import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/compras/routes";
import { inspeccionarCarpetas, prepararCarpetas } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** What Compras' folders look like in the project's CDE (nothing is created). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await inspeccionarCarpetas(ctx)));
}

/** Creates the missing folders and saves their ids (Documentos: administrar). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await prepararCarpetas(ctx)));
}
