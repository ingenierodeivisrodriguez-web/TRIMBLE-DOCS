import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { elementosMedibles } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The selected elements as a partida measures them (linked in Presupuesto, % already measured, location). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await elementosMedibles(ctx, await readJson(req))));
}
