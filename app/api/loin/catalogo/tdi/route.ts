import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/loin/routes";
import { guardarGruposTdi } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { grupos: [{ codigo, nombre }] }: the TDI group names of the catalog. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarGruposTdi(ctx, await readJson(req))));
}
