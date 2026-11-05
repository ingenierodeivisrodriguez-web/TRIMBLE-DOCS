import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/flujo-aprobacion/routes";
import { trazabilidad } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** ?flujoId=&estado=&desde=&hasta=&texto= (or ?archivoId=): each file with what happened to it, in order. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await trazabilidad(ctx, req.nextUrl.searchParams)));
}
