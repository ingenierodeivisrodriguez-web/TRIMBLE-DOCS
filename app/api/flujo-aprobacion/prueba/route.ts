import { NextRequest, NextResponse } from "next/server";
import { pasoPrueba } from "../../../../lib/flujo-aprobacion/prueba";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";
// A copy through the server may take a while with heavy models.
export const maxDuration = 300;

/** One step of the phase 0 test (equipo, archivo, copiar, estado-subida, estado-visor, tarea). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pasoPrueba(ctx.prueba, await readJson(req))));
}
