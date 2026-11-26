import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/inspeccion-360/routes";
import { listarCapturas } from "../../../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The point's captures, newest first, with their photo's thumbnail. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await listarCapturas(ctx, id)));
}
