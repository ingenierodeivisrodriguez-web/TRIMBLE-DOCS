import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../../lib/loin/routes";
import { agregarResultados } from "../../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** { lotes: [{ parte, elementoId, objetos }] }: slices of the audit's objects. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await agregarResultados(ctx, id, await readJson(req))));
}
