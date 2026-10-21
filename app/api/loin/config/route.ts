import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { updateConfig } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { baseProjectId?, editores? } (administrators), { valoresBasura?, umbralAmarillo? } (editors). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await updateConfig(ctx, await readJson(req))));
}
