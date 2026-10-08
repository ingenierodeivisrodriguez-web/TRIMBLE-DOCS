import { NextRequest, NextResponse } from "next/server";
import { procesarPago } from "../../../../../lib/manuales/pagos";
import { hoy, wompiDe } from "../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../lib/manuales/store";
import { EventoWompi, eventoValido } from "../../../../../lib/manuales/wompi";

export const dynamic = "force-dynamic";

/**
 * Wompi's events (set this URL in Wompi's dashboard). The event only says
 * which transaction changed: the transaction itself is read from Wompi
 * before applying it, so a forged event can't open the manuals. With
 * WOMPI_EVENTS_SECRET set, the event's checksum must also be valid.
 */
export async function POST(req: NextRequest) {
  const w = wompiDe();
  if (!w) return NextResponse.json({ error: "Wompi no está configurado (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET)." }, { status: 503 });
  const evento = (await req.json().catch(() => null)) as EventoWompi | null;
  if (!evento) return NextResponse.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  if (w.cfg.eventsSecret && !eventoValido(evento, w.cfg.eventsSecret, req.headers.get("x-event-checksum"))) {
    console.warn("[manuales] evento de Wompi con firma no válida");
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }
  const id = evento.data?.transaction?.id;
  if (evento.event !== "transaction.updated" || !id) return NextResponse.json({ ok: true, ignorado: true });

  try {
    const r = await procesarPago(manualesStore(), w.w, String(id), hoy());
    if (r.resultado !== "ajeno") console.info(`[manuales] transacción de Wompi ${id} de la compra ${r.orden}: ${r.resultado}`);
    return NextResponse.json({ ok: true, resultado: r.resultado });
  } catch (err) {
    // Wompi retries the event later.
    console.error(`[manuales] transacción de Wompi ${id}:`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
