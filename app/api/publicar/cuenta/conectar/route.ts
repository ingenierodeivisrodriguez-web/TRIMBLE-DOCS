import { NextRequest, NextResponse } from "next/server";
import { iniciarConexion } from "../../../../../lib/publicar/cuenta";
import { cuentaDeps, handle } from "../../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** Starts connecting the technical account (PUBLICAR_ADMINS): the Trimble sign-in address. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await iniciarConexion(ctx.store, cuentaDeps(), ctx.caller)));
}
