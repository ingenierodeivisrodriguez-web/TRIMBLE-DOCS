import { NextRequest, NextResponse } from "next/server";
import { ID_EXTENSION } from "../../../../../lib/flujo-aprobacion/correo";
import { abrirEnlace } from "../../../../../lib/flujo-aprobacion/enlaces";
import { flujoStore } from "../../../../../lib/flujo-aprobacion/store";

export const dynamic = "force-dynamic";

const PAGINA = (titulo: string, texto: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flujos documentales</title></head>
<body style="margin:0;background:#f4f6f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#2b3645">
<div style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #dfe4ea;border-radius:6px;overflow:hidden">
<div style="background:#2f4f8f;color:#fff;padding:14px 22px;font-size:15px;font-weight:600">Flujos documentales</div>
<div style="padding:22px;font-size:14px;line-height:1.5"><p style="margin:0 0 10px;font-weight:600">${titulo}</p><p style="margin:0 0 16px">${texto}</p>
<a href="https://web.connect.trimble.com" style="color:#2f4f8f">Ir a Trimble Connect</a></div></div></body></html>`;

/**
 * The button of an e-mail (phase 3): public, the token is the key. Notes the
 * click and sends the person to the extension in Trimble Connect, which then
 * opens that flow for the same Trimble user.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const destino = await abrirEnlace(flujoStore(), token, new Date(), process.env.FLUJO_EXTENSION_ID?.trim() || ID_EXTENSION);
    if (destino) return NextResponse.redirect(destino, 302);
    return new NextResponse(PAGINA("Este enlace ya no sirve.", "Venció o no existe. Abre Flujos documentales desde tu proyecto en Trimble Connect."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[flujo-aprobacion] enlace del correo:", err);
    return new NextResponse(PAGINA("No se pudo abrir el enlace.", "Intenta otra vez en un momento, o abre Flujos documentales desde tu proyecto en Trimble Connect."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
