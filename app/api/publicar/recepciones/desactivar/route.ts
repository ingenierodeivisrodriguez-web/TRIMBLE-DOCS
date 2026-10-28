import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/publicar/routes";
import { desactivarRecepcion } from "../../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** { origen }: administrators. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await desactivarRecepcion(ctx, await readJson(req))));
}
