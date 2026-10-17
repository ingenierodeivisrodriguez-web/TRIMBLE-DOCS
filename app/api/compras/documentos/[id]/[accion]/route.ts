import { NextRequest, NextResponse } from "next/server";
import { MAX_RELEVO } from "../../../../../../lib/compras/documentos";
import { handle, readJson } from "../../../../../../lib/compras/routes";
import { abrirDocumento, anularDocumento, confirmarDocumento, enviarDocumento, getHistorialDocumento, reintentarDocumento } from "../../../../../../lib/compras/service";
import { ServiceError } from "../../../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; accion: string }> };

/** historial: the document's sync history with Trimble. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, accion } = await params;
  return handle(req, async (ctx) => {
    if (accion !== "historial") throw new ServiceError("No existe.", 404);
    return NextResponse.json(await getHistorialDocumento(ctx, id));
  });
}

/**
 * confirmar | reintentar | abrir | anular ({ motivo }) | contenido (the file's bytes,
 * up to 4 MB, when the browser can't send them to Trimble itself).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, accion } = await params;
  return handle(req, async (ctx) => {
    if (accion === "confirmar") return NextResponse.json(await confirmarDocumento(ctx, id));
    if (accion === "reintentar") return NextResponse.json(await reintentarDocumento(ctx, id));
    if (accion === "abrir") return NextResponse.json(await abrirDocumento(ctx, id));
    if (accion === "anular") return NextResponse.json(await anularDocumento(ctx, id, await readJson(req)));
    if (accion === "contenido") {
      const largo = Number(req.headers.get("content-length") ?? "0");
      if (largo > MAX_RELEVO) throw new ServiceError("El archivo pasa los 4 MB que el servidor puede enviar por ti.", 413, "archivo-grande");
      const bytes = new Uint8Array(await req.arrayBuffer());
      return NextResponse.json(await enviarDocumento(ctx, id, bytes));
    }
    throw new ServiceError("No existe.", 404);
  });
}
