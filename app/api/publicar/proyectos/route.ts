import { NextRequest, NextResponse } from "next/server";
import { listarProyectos } from "../../../../lib/publicar/explorar";
import { handle } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** The projects the user belongs to, to choose the destination. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json({ proyectos: await listarProyectos(ctx.tc, ctx.projectId) }));
}
