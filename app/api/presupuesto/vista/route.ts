import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { pedirVista, tomarVista } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { itemId, elementos: [{ ifcGuid, modelId }] }: the elements to show in the 3D viewer's panel. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pedirVista(ctx, await readJson(req))));
}

/** The elements this user asked to see, once. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await tomarVista(ctx)));
}
