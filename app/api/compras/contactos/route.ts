import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getContactos } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** The project's people in Trimble Connect, to give them an access (accesos.administrar). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getContactos(ctx)));
}
