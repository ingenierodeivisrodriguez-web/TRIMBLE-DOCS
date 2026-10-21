import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/loin/routes";
import { aplicarPlantilla } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** { plantillaId }: copies a template into this project as a new discipline. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await aplicarPlantilla(ctx, await readJson(req))));
}
