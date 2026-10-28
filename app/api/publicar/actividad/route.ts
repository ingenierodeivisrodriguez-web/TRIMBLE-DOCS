import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/publicar/routes";
import { getActividad } from "../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD: this project's activity, newest first. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return handle(req, async (ctx) => NextResponse.json(await getActividad(ctx, { desde: q.get("desde"), hasta: q.get("hasta") })));
}
