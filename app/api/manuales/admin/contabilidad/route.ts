import { NextRequest, NextResponse } from "next/server";
import { handleAdmin, hoy } from "../../../../../lib/manuales/routes";
import type { Orden } from "../../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

const PAGINA = 1000;

/**
 * Every purchase with a payment (approved, to review or refunded), for the
 * statements; the screen builds them for any period. Also "today" and the
 * time zone the company's days are counted in.
 */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const ordenes: Orden[] = [];
    for (let offset = 0; offset < 100_000; offset += PAGINA) {
      const pagina = await store.listarOrdenes({ pagadas: true, limite: PAGINA, offset });
      ordenes.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    return NextResponse.json({ hoy: hoy(), zona: process.env.MANUALES_ZONA?.trim() || "America/Bogota", ordenes });
  });
}
