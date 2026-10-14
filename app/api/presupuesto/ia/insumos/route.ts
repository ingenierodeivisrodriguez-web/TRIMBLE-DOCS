import { NextRequest, NextResponse } from "next/server";
import { generarInsumosIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { contexto, partidas, catalogo }: the resources a batch of partidas needs; the missing ones become drafts. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await generarInsumosIA(ctx, await readJson(req))));
}
