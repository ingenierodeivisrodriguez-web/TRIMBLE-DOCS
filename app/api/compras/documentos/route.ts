import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { crearDocumento, getDocumentos } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** ?entidadTipo=&entidadId=: the documents the caller can see, the CDE folders and the legal document kinds. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getDocumentos(ctx, req.nextUrl.searchParams)));
}

/** { id, entidadTipo, entidadId, tipoDoc, nombreOriginal, tamano, sha256, origen, vence }: registers a document and opens its upload. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearDocumento(ctx, await readJson(req))));
}
