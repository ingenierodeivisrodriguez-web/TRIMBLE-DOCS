import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/ra/routes";
import { crearPunto } from "../../../../lib/ra/service";

export const dynamic = "force-dynamic";

/** Creates a QR point on a ready model (point, arrow direction, expiry). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearPunto(ctx, await readJson(req))));
}
