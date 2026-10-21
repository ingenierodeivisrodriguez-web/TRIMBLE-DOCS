import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { getMediciones, guardarMedicion } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The project's measurements with the partidas, contracts and structure to measure. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getMediciones(ctx)));
}

/** Registers or changes a measurement. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarMedicion(ctx, await readJson(req))));
}
