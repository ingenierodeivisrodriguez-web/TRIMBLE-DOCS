import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/presupuesto/routes";
import { eliminarPartida } from "../../../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Deletes a partida no other catalog partida uses as a subpartida. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => {
    await eliminarPartida(ctx, id);
    return NextResponse.json({ deleted: true });
  });
}
