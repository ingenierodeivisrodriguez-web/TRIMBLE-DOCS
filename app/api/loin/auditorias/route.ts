import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { crearAuditoria, getAuditorias } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The saved audits, newest first (without their objects). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAuditorias(ctx)));
}

/** { id, etapaId, resumen, nota }: starts saving an audit. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearAuditoria(ctx, await readJson(req))));
}
