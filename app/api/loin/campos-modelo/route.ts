import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { getCamposModelo, guardarCamposModelo } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The group and property names last read from the models. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getCamposModelo(ctx)));
}

/** { modelos, campos: [{ grupo, propiedad, cuenta }] }: read in the 3D viewer. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarCamposModelo(ctx, await readJson(req))));
}
