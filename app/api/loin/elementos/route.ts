import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { getElementos, guardarElemento } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** Disciplines, elements and their images (with signed links). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getElementos(ctx)));
}

/** Creates (version 0) or changes an element; to take it out of use, activo: false. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarElemento(ctx, await readJson(req))));
}
