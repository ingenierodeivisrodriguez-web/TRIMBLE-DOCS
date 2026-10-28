import { NextRequest, NextResponse } from "next/server";
import { listarProyectos, unirDestinos } from "../../../../lib/publicar/explorar";
import { handle } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";

/** Where this project can publish: the user's projects and those whose reception folder expects it. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => {
    const [proyectos, recepciones] = await Promise.all([listarProyectos(ctx.tc, ctx.projectId), ctx.store.recepcionesDeOrigen(ctx.projectId)]);
    return NextResponse.json({ destinos: unirDestinos(proyectos, recepciones, ctx.projectId) });
  });
}
