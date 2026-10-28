import { NextRequest, NextResponse } from "next/server";
import { pasoCopia } from "../../../../lib/publicar/copiar";
import { handle, readJson } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";
// A copy may stream the whole file (and its model) through this function (see TIEMPO_COPIA_MS).
export const maxDuration = 300;

/** { paso, destino, carpetaId, fileId, ... }: one step of copying one file to another project. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pasoCopia(ctx.copia, await readJson(req))));
}
