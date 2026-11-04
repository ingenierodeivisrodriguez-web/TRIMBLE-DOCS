import { NextRequest, NextResponse } from "next/server";
import { verCarpeta } from "../../../../lib/publicar/explorar";
import { handle } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** ?folderId=: a folder of this project (its root without folderId). Only this project. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await verCarpeta(ctx.tc, ctx.projectId, req.nextUrl.searchParams.get("folderId") || null)));
}
