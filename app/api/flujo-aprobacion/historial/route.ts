import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/flujo-aprobacion/routes";
import { historial } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** ?flujoId=&archivoId=: the history, newest first. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await historial(ctx, req.nextUrl.searchParams.get("flujoId"), req.nextUrl.searchParams.get("archivoId"))));
}
