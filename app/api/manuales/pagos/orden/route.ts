import { NextRequest, NextResponse } from "next/server";
import { esOrden, estadoCompra, verificarOrden } from "../../../../../lib/manuales/pagos";
import { handle, hoy, pasarelasDe } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** Pending purchases are checked against their gateway at most this often (the screen asks every few seconds). */
const CADA_MS = 8_000;
const consultadas = new Map<string, number>();

/**
 * `?id=`: how the caller's purchase is going. While it is pending it is also
 * checked against its gateway, so the license opens even if the payment's
 * notification is late.
 */
export async function GET(req: NextRequest) {
  return handle(req, async ({ persona, store }) => {
    const id = req.nextUrl.searchParams.get("id");
    if (!esOrden(id)) throw new ManualesError("Compra no válida.", 400, "parametro");
    let orden = await store.getOrden(id);
    if (!orden || (orden.email !== persona.email && !persona.esAdmin)) throw new ManualesError("No se encontró esa compra.", 404, "no-existe");
    if (orden.estado === "pendiente" && Date.now() - (consultadas.get(id) ?? 0) >= CADA_MS) {
      consultadas.set(id, Date.now());
      if (consultadas.size > 1000) for (const [k, t] of consultadas) if (Date.now() - t > 600_000) consultadas.delete(k);
      orden = await verificarOrden(store, pasarelasDe(), orden, hoy());
    }
    return NextResponse.json(estadoCompra(orden));
  });
}
