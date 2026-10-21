import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { guardarModelo } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { fileId, nombre, disciplinaIds }: the disciplines a model file belongs to. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarModelo(ctx, await readJson(req))));
}
