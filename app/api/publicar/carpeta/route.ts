import { NextRequest, NextResponse } from "next/server";
import { verCarpeta } from "../../../../lib/publicar/explorar";
import { handle } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** ?proyecto=&folderId=: a folder of a project the user belongs to (its root without folderId). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => {
    const q = req.nextUrl.searchParams;
    return NextResponse.json(await verCarpeta(ctx.tc, q.get("proyecto") || ctx.projectId, q.get("folderId") || null));
  });
}
