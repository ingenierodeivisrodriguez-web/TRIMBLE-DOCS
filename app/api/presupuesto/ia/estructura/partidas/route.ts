import { NextRequest, NextResponse } from "next/server";
import { proponerPartidasIA } from "../../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { descripcion, agrupacion, detalle, capitulo, otros, catalogo }: the partidas of one chapter, saved as a draft. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await proponerPartidasIA(ctx, await readJson(req))));
}
