import { NextRequest, NextResponse } from "next/server";
import { leerVenta } from "../../../../../lib/manuales/pagos";
import { cuentaMercadoPago, handleAdmin, mercadoPagoDe, urlPublica, urlsPago, wompiDe } from "../../../../../lib/manuales/routes";
import { problemasWompi } from "../../../../../lib/manuales/wompi";
import { ManualesError } from "../../../../../lib/manuales/service";
import type { ConfigVentaInfo } from "../../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

/** Online sales: open or closed, the plans on sale, and how Mercado Pago and Wompi are set up. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const venta = await store.getVenta();
    const mp = mercadoPagoDe();
    let cuenta: Awaited<ReturnType<typeof cuentaMercadoPago>> | null = null;
    let error: string | null = null;
    if (mp) {
      try {
        cuenta = await cuentaMercadoPago(mp);
      } catch (err) {
        error = err instanceof Error ? err.message : "No se pudo consultar Mercado Pago.";
      }
    }
    const w = wompiDe();
    const body: ConfigVentaInfo = {
      ...venta,
      mercadoPago: {
        configurado: !!mp,
        cuenta: cuenta ? { id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email } : null,
        error,
        prueba: !!(mp?.cfg.prueba || cuenta?.prueba),
        firma: !!mp?.cfg.webhookSecret,
        webhook: `${urlPublica(req)}/api/manuales/pagos/webhook`,
        retorno: urlsPago(req, "mercadopago").retorno,
      },
      wompi: {
        configurado: !!w,
        prueba: !!w?.cfg.prueba,
        privada: !!w?.cfg.privateKey,
        firma: !!w?.cfg.eventsSecret,
        problemas: w ? problemasWompi(w.cfg) : [],
        eventos: `${urlPublica(req)}/api/manuales/pagos/wompi`,
        retorno: urlsPago(req, "wompi").retorno,
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
    if (venta.habilitada && !mercadoPagoDe() && !wompiDe()) {
      throw new ManualesError("Antes de abrir la venta, configura Mercado Pago o Wompi en Vercel y vuelve a desplegar.", 409, "sin-pasarela");
    }
    await store.guardarVenta(venta, persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre);
    return NextResponse.json({ ok: true });
  });
}
