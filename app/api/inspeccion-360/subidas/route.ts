import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/inspeccion-360/routes";
import { iniciarSubida } from "../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

/** Registers a capture and returns the signed URL where the browser puts the photo. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await iniciarSubida(ctx, await readJson(req)), { status: 201 }));
}
