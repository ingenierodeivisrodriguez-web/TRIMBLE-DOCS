import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/ra/routes";
import { iniciarSubida } from "../../../../lib/ra/service";

export const dynamic = "force-dynamic";

/** Registers a prepared model and returns the signed URL to upload its file. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await iniciarSubida(ctx, await readJson(req))));
}
