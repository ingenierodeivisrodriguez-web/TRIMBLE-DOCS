import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getAccesos } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** Roles (with their permissions) and the people with an access. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAccesos(ctx)));
}
