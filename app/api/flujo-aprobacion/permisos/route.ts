import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/flujo-aprobacion/routes";
import { permisosFlujo } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** ?flujoId=: the Trimble permissions of a flow's folders, with warnings (administrators; read only). */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await permisosFlujo(ctx, req.nextUrl.searchParams.get("flujoId") ?? "")));
}
