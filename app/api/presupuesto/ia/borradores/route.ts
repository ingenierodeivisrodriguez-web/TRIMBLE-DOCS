import { NextRequest, NextResponse } from "next/server";
import { decidirBorradoresIA, listarBorradoresIA } from "../../../../../lib/presupuesto/ia/servicio";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";

/** The drafts of a task (?tarea=edt|estructura|insumos|apu) waiting for review. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await listarBorradoresIA(ctx, req.nextUrl.searchParams.get("tarea") ?? "edt")));
}

/** { decisiones: [{ id, estado, final? }] }: records what was accepted, edited or rejected. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await decidirBorradoresIA(ctx, await readJson(req))));
}
