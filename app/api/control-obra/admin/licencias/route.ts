import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { getLicencias, registrarLicencia } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Technical administrator: the license history of a company. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getLicencias(ctx, req.nextUrl.searchParams.get("empresaId"))));
}

/** Technical administrator: records a license event (always a new row). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await registrarLicencia(ctx, await readJson(req))));
}
