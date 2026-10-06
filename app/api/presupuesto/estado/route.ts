import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/presupuesto/routes";
import { getEstado } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** The project's configuration and what the caller can do. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstado(ctx)));
}
