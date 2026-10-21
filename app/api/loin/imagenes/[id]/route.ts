import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/loin/routes";
import { eliminarImagen } from "../../../../../lib/loin/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Removes a reference image (images can be removed; requirements are only deactivated). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => {
    await eliminarImagen(ctx, id);
    return NextResponse.json({ deleted: true });
  });
}
