import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/compras/routes";
import { accionComparativo } from "../../../../../lib/compras/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The comparison of requisition {id}: { accion: guardar | proponer | aprobar | devolver, criterios, cotizacionElegidaId, justificacion, motivo, version }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await accionComparativo(ctx, id, await readJson(req))));
}
