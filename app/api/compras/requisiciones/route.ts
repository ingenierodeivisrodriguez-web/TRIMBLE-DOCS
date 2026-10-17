import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { getRequisiciones, guardarRequisicion } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** The project's requisitions and the tolerance (Requisiciones: ver). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getRequisiciones(ctx)));
}

/** { id?, fechaRequerida, prioridad, justificacion, lineas, version }: creates or changes a draft. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarRequisicion(ctx, await readJson(req))));
}
