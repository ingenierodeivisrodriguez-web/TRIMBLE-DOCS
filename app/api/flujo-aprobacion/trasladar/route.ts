import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";
import { pasoTraslado } from "../../../../lib/flujo-aprobacion/trasladar";

export const dynamic = "force-dynamic";
// A copy through the server may take a while with heavy models.
export const maxDuration = 300;

/** { archivoId, paso: trasladar | confirmar | reemplazar, siVersion }: copies the approved version to the destination folder. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await pasoTraslado(ctx, await readJson(req))));
}
