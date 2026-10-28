import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/publicar/routes";
import { getPublicaciones, publicar } from "../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** The publications from or to this project, with their files. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getPublicaciones(ctx)));
}

/** { destino, items: [{ tipo, id }], nota } */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await publicar(ctx, await readJson(req))));
}
