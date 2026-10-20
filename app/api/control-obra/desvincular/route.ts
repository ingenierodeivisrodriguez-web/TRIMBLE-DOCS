import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { desvincular } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Takes this project out of its company, with a reason (its data stays). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await desvincular(ctx, await readJson(req))));
}
