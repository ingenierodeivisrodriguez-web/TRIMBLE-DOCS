import { NextRequest, NextResponse } from "next/server";
import { decidir } from "../../../../lib/flujo-aprobacion/decisiones";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// Approving the last step may copy the approved version to the chosen folder right away.
export const maxDuration = 300;

/** { archivoId, versionId, texto, destino? }: approves the step the file waits for (texto: optional comment; destino: folder for the approved version). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await decidir(ctx, await readJson(req), "aprobar")));
}
