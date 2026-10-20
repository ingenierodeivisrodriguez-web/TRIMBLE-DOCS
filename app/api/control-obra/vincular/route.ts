import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { vincular } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Registers this project in a company (company administrator who is ADMIN of the project in Trimble). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await vincular(ctx, await readJson(req))));
}
