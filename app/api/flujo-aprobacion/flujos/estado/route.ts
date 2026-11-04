import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/flujo-aprobacion/routes";
import { cambiarEstado } from "../../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** { id, version, activo }: deactivates or activates a flow (administrators). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await cambiarEstado(ctx, await readJson(req))));
}
