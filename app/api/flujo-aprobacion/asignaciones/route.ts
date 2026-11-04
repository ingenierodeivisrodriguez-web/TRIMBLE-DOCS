import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";
import { agregarAsignaciones } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** Gives a person or group a role on folders or files of a flow (administrators). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await agregarAsignaciones(ctx, await readJson(req))));
}
