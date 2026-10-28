import { NextRequest, NextResponse } from "next/server";
import { completarConexion } from "../../../../../lib/publicar/cuenta";
import { cuentaDeps, handle, readJson } from "../../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** { enlace }: the address Trimble sent the browser to after signing in (http://localhost/?code=…). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => {
    const body = (await readJson(req)) as { enlace?: unknown } | null;
    return NextResponse.json(await completarConexion(ctx.store, cuentaDeps(), ctx.caller, typeof body?.enlace === "string" ? body.enlace : ""));
  });
}
