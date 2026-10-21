import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { guardarDisciplina } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** Creates (version 0) or changes a discipline; to take it out of use, activo: false. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarDisciplina(ctx, await readJson(req))));
}
