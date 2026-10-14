import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { getProgramacion, guardarProgramacion } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** The budget's schedule (Gantt): null until it is first saved. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getProgramacion(ctx)));
}

/** { programacion, version }: saves it if nobody saved it since `version`; answers 409 otherwise. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarProgramacion(ctx, await readJson(req))));
}
