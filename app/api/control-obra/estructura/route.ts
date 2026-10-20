import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/control-obra/routes";
import { getEstructura } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The levels in force in this project, the company's template, the values and the settings. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstructura(ctx)));
}
