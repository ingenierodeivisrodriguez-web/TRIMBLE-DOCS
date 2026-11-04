import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/flujo-aprobacion/routes";
import { quitarAsignacion } from "../../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** { id }: takes a role away; the assignment stays, inactive (administrators). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await quitarAsignacion(ctx, await readJson(req))));
}
