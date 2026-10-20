import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/control-obra/routes";
import { getContactos } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The project's people in Trimble Connect (administrators only). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getContactos(ctx)));
}
