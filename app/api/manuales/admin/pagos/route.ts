import { NextRequest, NextResponse } from "next/server";
import { esOrden, verificarOrden } from "../../../../../lib/manuales/pagos";
import { handleAdmin, hoy, mercadoPagoDe } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** The purchases of licenses, newest first. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => NextResponse.json({ hoy: hoy(), ordenes: await store.listarOrdenes({ limite: 500 }) }));
}

/** `{ orden }`: checks a pending purchase against Mercado Pago now. */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const body = (await req.json().catch(() => null)) as { orden?: unknown } | null;
    if (!esOrden(body?.orden)) throw new ManualesError("Compra no válida.", 400, "parametro");
    const orden = await store.getOrden(body.orden);
    if (!orden) throw new ManualesError("No se encontró esa compra.", 404, "no-existe");
    const mp = mercadoPagoDe();
    if (!mp) throw new ManualesError("Mercado Pago no está configurado (MERCADOPAGO_ACCESS_TOKEN).", 409, "sin-mercadopago");
    return NextResponse.json({ orden: await verificarOrden(store, mp.mp, orden, hoy()) });
  });
}
