import { NextRequest } from "next/server";
import { paginaDeOrden, paginaPago } from "../../../../../lib/manuales/paginaPago";
import { esOrden, procesarPago, verificarOrden } from "../../../../../lib/manuales/pagos";
import { hoy, mercadoPagoDe, pasarelasDe } from "../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

/**
 * Mercado Pago's return (back_urls): `?payment_id=&status=&external_reference=`.
 * The payment is read from Mercado Pago and applied right away, so the
 * license opens even before its notification arrives.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mp = mercadoPagoDe();
  if (!mp) return paginaPago("error", "Pago no disponible", "La compra en línea con Mercado Pago no está configurada.");
  const store = manualesStore();
  const pagoId = q.get("payment_id") ?? q.get("collection_id");
  const referencia = q.get("external_reference");
  try {
    if (pagoId && /^\d{1,20}$/.test(pagoId)) {
      const r = await procesarPago(store, mp.mp, pagoId, hoy());
      if (r.resultado === "ajeno" || !r.orden) {
        return paginaPago("error", "No encontramos esta compra", "Si pagaste, escribe al administrador de los manuales con el número de tu pago en Mercado Pago.");
      }
      return paginaDeOrden(await store.getOrden(r.orden));
    }
    if (esOrden(referencia)) {
      const o = await store.getOrden(referencia);
      return paginaDeOrden(o ? await verificarOrden(store, pasarelasDe(), o, hoy()) : null);
    }
    return paginaPago("error", "No se completó el pago", "Vuelve a Trimble Connect para intentarlo de nuevo.");
  } catch (err) {
    console.error("[manuales] retorno de Mercado Pago:", err);
    return paginaPago("espera", "No pudimos confirmar el pago todavía", "Si pagaste, tu acceso se activará solo en unos minutos, cuando Mercado Pago lo confirme.");
  }
}
