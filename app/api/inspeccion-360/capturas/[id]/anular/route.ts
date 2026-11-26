import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../../lib/inspeccion-360/routes";
import { anularCaptura } from "../../../../../../lib/inspeccion-360/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => NextResponse.json(await anularCaptura(ctx, id, await readJson(req))));
}
