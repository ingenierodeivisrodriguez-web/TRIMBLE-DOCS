import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { guardarAdminEmpresa } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Technical administrator: names or removes a company administrator by e-mail. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarAdminEmpresa(ctx, await readJson(req))));
}
