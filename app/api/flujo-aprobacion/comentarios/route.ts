import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/flujo-aprobacion/routes";
import { comentar, comentarios } from "../../../../lib/flujo-aprobacion/service";

export const dynamic = "force-dynamic";

/** ?flujoId=: the comments of a flow, oldest first. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await comentarios(ctx, req.nextUrl.searchParams.get("flujoId") ?? "")));
}

/** { flujoId, texto }: adds a comment (never edited or deleted). */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await comentar(ctx, await readJson(req))));
}
