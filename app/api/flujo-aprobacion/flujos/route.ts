import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";
import { estado, guardarFlujo } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";
// Saving registers the flow's files at once (reading them in Trimble, as "Revisar ahora").
export const maxDuration = 120;

/** The project's flows. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await estado(ctx)));
}

/** Creates a flow (any member) or changes it (its creator or an administrator), and registers its files. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await guardarFlujo(ctx, await readJson(req))));
}
