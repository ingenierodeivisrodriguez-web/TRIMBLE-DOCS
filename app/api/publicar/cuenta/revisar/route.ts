import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/publicar/routes";
import { revisarAcceso } from "../../../../../lib/publicar/service";

export const dynamic = "force-dynamic";

/** What the technical account can do in this project (member, reception folders, what is published). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await revisarAcceso(ctx)));
}
