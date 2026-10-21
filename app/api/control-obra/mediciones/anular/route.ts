import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { anularMedicion } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Cancels a registered measurement, with a reason. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await anularMedicion(ctx, await readJson(req))));
}
