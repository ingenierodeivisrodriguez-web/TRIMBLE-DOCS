import { NextRequest, NextResponse } from "next/server";
import { registrarApertura } from "../../../../lib/flujo-aprobacion/apertura";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** { archivoId }: notes in the history that the notified person opened the file (first time per version). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await registrarApertura(ctx, await readJson(req))));
}
