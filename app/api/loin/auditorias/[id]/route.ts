import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/loin/routes";
import { cerrarAuditoria, getAuditoria } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A saved audit with its objects. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await getAuditoria(ctx, id)));
}

/** { partes }: closes the audit once all its slices are saved. */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await cerrarAuditoria(ctx, id, await readJson(req))));
}
