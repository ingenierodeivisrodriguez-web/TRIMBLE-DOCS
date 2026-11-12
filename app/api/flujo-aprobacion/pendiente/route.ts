import { NextRequest, NextResponse } from "next/server";
import { tomarPendiente } from "../../../../lib/flujo-aprobacion/enlaces";
import { handle } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** When the extension opens: the flow an e-mail's button asked for in the last minutes (phase 3). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await tomarPendiente(ctx)));
}
