import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/loin/routes";
import { guardarParametros } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { parametros: [{ id, version, ... }] }: all saved or none (there is no delete: they are deactivated). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarParametros(ctx, await readJson(req))));
}
