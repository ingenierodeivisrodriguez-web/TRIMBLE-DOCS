import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../../lib/compras/routes";
import { accionRequisicion } from "../../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** { accion: enviar | aprobar | rechazar | devolver | anular, motivo, aprobadas?, version }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await accionRequisicion(ctx, id, await readJson(req))));
}
