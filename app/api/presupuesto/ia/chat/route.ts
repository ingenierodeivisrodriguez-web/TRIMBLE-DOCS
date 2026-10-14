import { NextRequest, NextResponse } from "next/server";
import { chatIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** { pregunta, contexto, historial }: answers a question about the open budget (it only reads). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await chatIA(ctx, await readJson(req))));
}
