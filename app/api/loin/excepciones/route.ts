import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { crearExcepciones, getExcepciones, revocarExcepcion } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** Every exception of the project, in force and revoked. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getExcepciones(ctx)));
}

/** { filas: [{ id, etapaId, ifcGuid, parametroId, elementoId, justificacion }] }: accepts failures. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearExcepciones(ctx, await readJson(req))));
}

/** { id, motivo }: revokes an exception (it is never deleted). */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await revocarExcepcion(ctx, await readJson(req))));
}
