import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/presupuesto/routes";
import { updateConfig } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** { baseProjectId?, editores? }: administrators only. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await updateConfig(ctx, await readJson(req))));
}
