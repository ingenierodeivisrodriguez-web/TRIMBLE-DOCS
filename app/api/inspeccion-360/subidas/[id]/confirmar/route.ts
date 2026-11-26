import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/inspeccion-360/routes";
import { confirmarSubida } from "../../../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";
// The photo (up to 60 MB) is copied from Supabase to Trimble Connect's storage.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await confirmarSubida(ctx, id)));
}
