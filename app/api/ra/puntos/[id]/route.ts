import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/ra/routes";
import { anularPunto } from "../../../../../lib/ra/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cancels the QR (it stops opening; the record stays). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await anularPunto(ctx, id)));
}
