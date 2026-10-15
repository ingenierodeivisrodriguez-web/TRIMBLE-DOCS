import { NextRequest, NextResponse } from "next/server";
import { generarProgramaIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { contexto, alcance, actividades }: work packages and constructive sequence of the schedule's activities, saved as a draft. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await generarProgramaIA(ctx, await readJson(req))));
}
