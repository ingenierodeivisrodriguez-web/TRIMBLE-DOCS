import { NextRequest, NextResponse } from "next/server";
import { leerVenta } from "../../../../../lib/manuales/pagos";
import { handleAdmin, mercadoPagoDe, urlPublica, urlsPago } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";
import type { ConfigVentaInfo } from "../../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

/** Online sales: open or closed, the plans on sale, and how Mercado Pago is set up. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const venta = await store.getVenta();
    const mp = mercadoPagoDe();
    const body: ConfigVentaInfo = {
      ...venta,
      mercadoPago: {
        configurado: !!mp,
        prueba: !!mp?.cfg.prueba,
        firma: !!mp?.cfg.webhookSecret,
        webhook: `${urlPublica(req)}/api/manuales/pagos/webhook`,
        retorno: urlsPago(req).retorno,
      },
    };
    return NextResponse.json(body);
  });
}

/** `{ habilitada, planes: [{ meses, precio }] }`. */
export async function PUT(req: NextRequest) {
  return handleAdmin(req, async ({ store, persona }) => {
    const body = await req.json().catch(() => null);
    if (!body) throw new ManualesError("El cuerpo de la solicitud no es JSON válido.", 400, "parametro");
    const venta = leerVenta(body);
    if (venta.habilitada && !mercadoPagoDe()) {
      throw new ManualesError("Antes de abrir la venta, agrega MERCADOPAGO_ACCESS_TOKEN en Vercel y vuelve a desplegar.", 409, "sin-mercadopago");
    }
    await store.guardarVenta(venta, persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre);
    return NextResponse.json({ ok: true });
  });
}
