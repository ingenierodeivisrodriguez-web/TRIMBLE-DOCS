import { NextRequest, NextResponse } from "next/server";
import { iniciarCompra } from "../../../../lib/manuales/pagos";
import { handle, hoy, pasarelasDe, urlsPago } from "../../../../lib/manuales/routes";
import { ManualesError } from "../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/**
 * `{ meses, pasarela: "mercadopago" | "wompi" }`: starts the purchase of a
 * license for the caller's own e-mail and returns the gateway's checkout
 * (`url`) and the purchase id to follow it.
 */
export async function POST(req: NextRequest) {
  return handle(req, async ({ persona, store }) => {
    const body = await req.json().catch(() => null);
    if (!body) throw new ManualesError("El cuerpo de la solicitud no es JSON válido.", 400, "parametro");
    const compra = await iniciarCompra(store, pasarelasDe(), { email: persona.email, nombre: persona.nombre }, body, (p) => urlsPago(req, p), hoy());
    return NextResponse.json(compra);
  });
}
