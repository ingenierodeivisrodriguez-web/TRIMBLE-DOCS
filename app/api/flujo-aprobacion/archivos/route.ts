import { NextRequest, NextResponse } from "next/server";
import { listarArchivos } from "../../../../lib/flujo-aprobacion/revision";
import { handle } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** Every registered file, with the step it waits for and whether it is the caller's turn. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await listarArchivos(ctx)));
}
