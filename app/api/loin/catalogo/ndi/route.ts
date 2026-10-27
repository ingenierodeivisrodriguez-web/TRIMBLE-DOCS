import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/loin/routes";
import { guardarNivelesNdi } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { niveles: [{ numero, nombre }] }: the NDI levels of the catalog. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarNivelesNdi(ctx, await readJson(req))));
}
