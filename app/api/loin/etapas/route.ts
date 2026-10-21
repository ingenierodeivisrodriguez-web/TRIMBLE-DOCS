import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { guardarEtapa } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** Creates (version 0) or changes a stage; to take it out of use, activo: false. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarEtapa(ctx, await readJson(req))));
}
