import { NextRequest, NextResponse } from "next/server";
import { desconectar, estadoCuenta } from "../../../../../lib/publicar/cuenta";
import { cuentaDeps, handle } from "../../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** Disconnects the technical account (PUBLICAR_ADMINS). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => {
    const deps = cuentaDeps();
    await desconectar(ctx.store, deps, ctx.caller);
    return NextResponse.json(await estadoCuenta(ctx.store, deps, ctx.caller));
  });
}
