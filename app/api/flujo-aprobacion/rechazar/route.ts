import { NextRequest, NextResponse } from "next/server";
import { decidir } from "../../../../lib/flujo-aprobacion/decisiones";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** { archivoId, versionId, texto }: rejects the file at the step it waits for (texto: the reason, required). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await decidir(ctx, await readJson(req), "rechazar")));
}
