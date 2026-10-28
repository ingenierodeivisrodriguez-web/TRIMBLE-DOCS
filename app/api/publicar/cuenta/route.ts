import { NextRequest, NextResponse } from "next/server";
import { estadoCuenta } from "../../../../lib/publicar/cuenta";
import { cuentaDeps, handle } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** The technical account as everyone sees it, and whether the caller may manage it. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await estadoCuenta(ctx.store, cuentaDeps(), ctx.caller)));
}
