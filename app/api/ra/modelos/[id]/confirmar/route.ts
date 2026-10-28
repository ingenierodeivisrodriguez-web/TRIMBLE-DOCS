import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/ra/routes";
import { confirmarSubida } from "../../../../../../lib/ra/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** After the upload: checks the file arrived whole and marks the model ready. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await confirmarSubida(ctx, id)));
}
