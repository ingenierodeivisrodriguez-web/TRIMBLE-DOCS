import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/compras/routes";
import { getAuditoria } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** ?desde=&hasta=&actor=&modulo=&resultado=&antesDe=: the audit, newest first. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAuditoria(ctx, req.nextUrl.searchParams)));
}
