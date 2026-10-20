import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/control-obra/routes";
import { verificarBitacora } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Recomputes the company's chain (the check is recorded too). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await verificarBitacora(ctx)));
}
