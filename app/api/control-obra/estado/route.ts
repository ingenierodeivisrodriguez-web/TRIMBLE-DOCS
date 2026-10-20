import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/control-obra/routes";
import { getEstado } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Who is calling, the company of this project, its license and the caller's access. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEstado(ctx)));
}
