import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { getMatriz, guardarMatriz } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The project's stages and the cells of its LOIN matrix. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getMatriz(ctx)));
}

/** { celdas: [{ id, version, elementoId, etapaId, lod, ndi, propositos, actor, nota }] }: all saved or none. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarMatriz(ctx, await readJson(req))));
}
