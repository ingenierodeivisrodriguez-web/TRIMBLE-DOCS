import { NextRequest, NextResponse } from "next/server";
import { firmaValida } from "../../../../../lib/manuales/mercadopago";
import { procesarPago } from "../../../../../lib/manuales/pagos";
import { hoy, mercadoPagoDe } from "../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

/**
 * Mercado Pago's payment notifications (webhooks, and the older IPN form
 * `?topic=payment&id=`). The notice only says which payment changed: the
 * payment itself is read from Mercado Pago with our credentials before
 * applying it, so a forged notice can't open the manuals. With
 * MERCADOPAGO_WEBHOOK_SECRET set, signed notices must also carry a valid
 * signature.
 */
export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const body = (await req.json().catch(() => null)) as { type?: string; topic?: string; data?: { id?: unknown } } | null;
  const tipo = q.get("type") ?? q.get("topic") ?? body?.type ?? body?.topic ?? "";
  const dataId = q.get("data.id");
  const id = dataId ?? (body?.data?.id !== undefined && body?.data?.id !== null ? String(body.data.id) : null) ?? q.get("id");

  const mp = mercadoPagoDe();
  if (!mp) return NextResponse.json({ error: "Mercado Pago no está configurado (MERCADOPAGO_ACCESS_TOKEN)." }, { status: 503 });
  const firma = req.headers.get("x-signature");
  if (mp.cfg.webhookSecret && firma && !firmaValida(mp.cfg.webhookSecret, firma, req.headers.get("x-request-id"), dataId ?? id)) {
    console.warn("[manuales] notificación de Mercado Pago con firma no válida");
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }
  if (tipo !== "payment" || !id) return NextResponse.json({ ok: true, ignorada: true });

  try {
    const r = await procesarPago(manualesStore(), mp.mp, id, hoy());
    if (r.resultado !== "ajeno") console.info(`[manuales] pago ${id} de la compra ${r.orden}: ${r.resultado}`);
    return NextResponse.json({ ok: true, resultado: r.resultado });
  } catch (err) {
    // Mercado Pago retries the notification later.
    console.error(`[manuales] pago ${id}:`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
