import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/control-obra/routes";
import { getEmpresas, guardarEmpresa } from "../../../../../lib/control-obra/service";

export const dynamic = "force-dynamic";

/** Technical administrator: every company with its license, projects and administrators. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getEmpresas(ctx)));
}

/** Technical administrator: creates or changes a company. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarEmpresa(ctx, await readJson(req))));
}
