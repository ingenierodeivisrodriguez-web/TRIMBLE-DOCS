import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";
import { estado, guardarFlujo } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** The project's flows with their active assignments. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await estado(ctx)));
}

/** Creates or changes a flow (administrators). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await guardarFlujo(ctx, await readJson(req))));
}
