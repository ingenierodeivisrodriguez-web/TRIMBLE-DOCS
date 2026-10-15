import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/presupuesto/routes";
import { crearLineaBase, getLineaBase, usarLineaBase } from "../../../../../lib/presupuesto/servicioAvance";

export const dynamic = "force-dynamic";

/** ?id=: one baseline with its rows. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getLineaBase(ctx, req.nextUrl.searchParams.get("id"))));
}

/** { nombre, datos }: saves a new baseline, which becomes the one in force. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearLineaBase(ctx, await readJson(req))));
}

/** { id }: makes another baseline the one in force. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await usarLineaBase(ctx, await readJson(req))));
}
