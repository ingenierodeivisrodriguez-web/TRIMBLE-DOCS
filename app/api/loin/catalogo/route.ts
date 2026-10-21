import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/loin/routes";
import { getCatalogo } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The parameter catalog of the project's base, with its TDI groups. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getCatalogo(ctx)));
}
