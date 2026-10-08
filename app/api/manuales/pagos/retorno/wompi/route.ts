import { NextRequest } from "next/server";
import { paginaDeOrden, paginaPago } from "../../../../../../lib/manuales/paginaPago";
import { procesarPago } from "../../../../../../lib/manuales/pagos";
import { hoy, wompiDe } from "../../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

/**
 * Wompi's return (redirect-url): `?id=<transaction>`. The transaction is
 * read from Wompi and applied right away, so the license opens even before
 * its event arrives.
 */
export async function GET(req: NextRequest) {
  const w = wompiDe();
  if (!w) return paginaPago("error", "Pago no disponible", "La compra en línea con Wompi no está configurada.");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return paginaPago("error", "No se completó el pago", "Vuelve a Trimble Connect para intentarlo de nuevo.");
  const store = manualesStore();
  try {
    const r = await procesarPago(store, w.w, id, hoy());
    if (r.resultado === "ajeno" || !r.orden) {
      return paginaPago("error", "No encontramos esta compra", "Si pagaste, escribe al administrador de los manuales con el número de tu transacción en Wompi.");
    }
    return paginaDeOrden(await store.getOrden(r.orden));
  } catch (err) {
    console.error("[manuales] retorno de Wompi:", err);
    return paginaPago("espera", "No pudimos confirmar el pago todavía", "Si pagaste, tu acceso se activará solo en unos minutos, cuando Wompi lo confirme.");
  }
}
