import { NextRequest, NextResponse } from "next/server";
import { pasoPrueba } from "../../../../lib/publicar/prueba";
import { handle, readJson } from "../../../../lib/publicar/routes";

export const dynamic = "force-dynamic";
// A copy streams the whole file through this function (see TIEMPO_COPIA_MS).
export const maxDuration = 300;

/** { paso, ... }: one step of the test that copies a file to another project. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pasoPrueba(ctx.prueba, await readJson(req))));
}
