import { NextRequest, NextResponse } from "next/server";
import { generarApuIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { contexto, partidas, catalogo, evaluar? }: the unit cost analysis of a batch of partidas, saved as drafts (or only returned when evaluating). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await generarApuIA(ctx, await readJson(req))));
}
