import { NextRequest, NextResponse } from "next/server";
import { proponerCapitulosIA } from "../../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { descripcion, agrupacion, detalle }: the chapters of the EDT of the described project. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await proponerCapitulosIA(ctx, await readJson(req))));
}
