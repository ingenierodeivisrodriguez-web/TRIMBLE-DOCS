import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/publicar/routes";
import { cambiarEstado } from "../../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** { id, accion: "detener" | "reanudar" } */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await cambiarEstado(ctx, await readJson(req))));
}
