import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../../lib/compras/routes";
import { estadoProveedor } from "../../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** { estado: activo | inactivo | bloqueado, motivo, version }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await estadoProveedor(ctx, id, await readJson(req))));
}
