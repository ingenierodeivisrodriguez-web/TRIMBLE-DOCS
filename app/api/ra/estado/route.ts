import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/ra/routes";
import { estado } from "../../../../lib/ra/service";

export const dynamic = "force-dynamic";

/** The project's prepared models and settings (removes expired files first). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await estado(ctx)));
}
