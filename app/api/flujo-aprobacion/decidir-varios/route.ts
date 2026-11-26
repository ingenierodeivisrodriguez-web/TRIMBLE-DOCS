import { NextRequest, NextResponse } from "next/server";
import { decidirVarios } from "../../../../lib/flujo-aprobacion/decisiones";
import { FlujoError } from "../../../../lib/flujo-aprobacion/errores";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// Up to 100 files, each one checked against Trimble's latest version.
export const maxDuration = 300;

/** { decision: "aprobar" | "rechazar", flujoId, archivos: [{ archivoId, versionId }], texto, destino? }: decides several files of one flow at once. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => {
    const body = (await readJson(req)) as Record<string, unknown> | null;
    const decision = body?.decision;
    if (decision !== "aprobar" && decision !== "rechazar") throw new FlujoError("La decisión no es válida.");
    return NextResponse.json(await decidirVarios(ctx, body, decision));
  });
}
