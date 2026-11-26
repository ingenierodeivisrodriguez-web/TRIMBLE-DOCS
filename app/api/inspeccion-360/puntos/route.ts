import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/inspeccion-360/routes";
import { crearPunto, listarPuntos } from "../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await listarPuntos(ctx)));
}

export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearPunto(ctx, await readJson(req)), { status: 201 }));
}
