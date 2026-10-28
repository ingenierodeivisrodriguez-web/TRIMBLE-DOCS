import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/publicar/routes";
import { getRecepciones, guardarRecepcion } from "../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** The reception folders of this project (as destination). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getRecepciones(ctx)));
}

/** { origen, carpetaId, origenNombre? }: administrators. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarRecepcion(ctx, await readJson(req))));
}
