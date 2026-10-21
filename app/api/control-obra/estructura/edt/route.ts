import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/control-obra/routes";
import { propuestasUbicacion } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** The values of the structure that the schedule's EDT proposes (nothing is created). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await propuestasUbicacion(ctx)));
}
