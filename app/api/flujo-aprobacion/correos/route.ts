import { NextRequest, NextResponse } from "next/server";
import { guardarCorreos, leerCorreos } from "../../../../lib/flujo-aprobacion/correo";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** «Correos de aviso» of the project (administrators). */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await leerCorreos(ctx)));
}

/** { config, version }: saves them (administrators). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await guardarCorreos(ctx, await readJson(req))));
}
