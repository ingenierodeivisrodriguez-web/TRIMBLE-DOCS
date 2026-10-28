import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/publicar/routes";
import { sincronizar } from "../../../../lib/publicar/service";

export const dynamic = "force-dynamic";
// A copy may stream a whole file through this function (see TIEMPO_COPIA_MS).
export const maxDuration = 300;

/** { paso: "plan" | "copiar" | "confirmar" | "reemplazar", archivoId?, siVersion? } */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await sincronizar(ctx, await readJson(req))));
}
