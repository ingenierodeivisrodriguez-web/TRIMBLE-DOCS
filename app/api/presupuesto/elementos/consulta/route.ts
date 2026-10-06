import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { consultarElementos } from "../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { itemIds?: [...], ifcGuids?: [...] }: the elements of some partidas, or the partidas of some elements. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await consultarElementos(ctx, await readJson(req))));
}
