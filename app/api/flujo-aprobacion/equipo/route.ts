import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/flujo-aprobacion/routes";
import { equipo } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** The project's people and groups, as Trimble lists them. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await equipo(ctx)));
}
