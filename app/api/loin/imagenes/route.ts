import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/loin/routes";
import { subirImagen } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The image itself as the body (already reduced in the browser); ?elementoId=&nombre=&ancho=&alto= */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => {
    const q = req.nextUrl.searchParams;
    const contenido = new Uint8Array(await req.arrayBuffer());
    const datos = { elementoId: q.get("elementoId"), nombre: q.get("nombre"), ancho: q.get("ancho"), alto: q.get("alto"), tipo: req.headers.get("content-type") ?? "" };
    return NextResponse.json(await subirImagen(ctx, datos, contenido));
  });
}
