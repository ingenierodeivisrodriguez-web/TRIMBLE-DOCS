import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/control-obra/routes";
import { getAccesos } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Roles, people and the accesses of this project. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAccesos(ctx)));
}
