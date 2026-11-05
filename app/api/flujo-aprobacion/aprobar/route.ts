import { NextRequest, NextResponse } from "next/server";
import { decidir } from "../../../../lib/flujo-aprobacion/decisiones";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// Approving the last step copies the approved version to the destination right away.
export const maxDuration = 300;

/** { archivoId, versionId, texto }: approves the step the file waits for (texto: optional comment). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await decidir(ctx, await readJson(req), "aprobar")));
}
