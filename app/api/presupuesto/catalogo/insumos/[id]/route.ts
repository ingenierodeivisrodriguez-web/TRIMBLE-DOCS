import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/presupuesto/routes";
import { eliminarInsumo } from "../../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Deletes a resource no catalog partida uses. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => {
    await eliminarInsumo(ctx, id);
    return NextResponse.json({ deleted: true });
  });
}
