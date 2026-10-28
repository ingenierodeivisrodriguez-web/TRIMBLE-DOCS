import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/publicar/routes";
import { recepcionHacia } from "../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** ?destino=: where publishing from this project to that one arrives. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await recepcionHacia(ctx, req.nextUrl.searchParams.get("destino") ?? "")));
}
