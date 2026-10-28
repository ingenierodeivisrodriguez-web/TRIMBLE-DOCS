import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/ra/routes";
import { archivoModelo } from "../../../../../../lib/ra/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A 10-minute link to the model's file (the viewer panel reads it to place a QR). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await archivoModelo(ctx, id)));
}
