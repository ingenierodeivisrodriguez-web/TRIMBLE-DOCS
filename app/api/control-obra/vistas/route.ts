import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/control-obra/routes";
import { pedirVista, tomarVista } from "../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** What this person's viewer panel must select when it opens (taken once). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await tomarVista(ctx)));
}

/** Asks the viewer panel to select some elements (from the project's menu). */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await pedirVista(ctx, await readJson(req))));
}
