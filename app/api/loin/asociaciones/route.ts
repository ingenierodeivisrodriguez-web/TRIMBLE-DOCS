import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { asociar } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { elementoId (null: unlink), objetos: [{ ifcGuid, fileId }] }: manual links, which win over the rules. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await asociar(ctx, await readJson(req))));
}
