import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/ra/routes";
import { guardarConfig } from "../../../../lib/ra/service";

export const dynamic = "force-dynamic";

/** { diasSinUso }: how many days an unused model is kept (administrators). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarConfig(ctx, await readJson(req))));
}
