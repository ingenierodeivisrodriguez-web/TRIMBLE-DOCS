import { NextRequest, NextResponse } from "next/server";
import { puedeLeer } from "../../../../lib/manuales/acceso";
import { oauthConfig } from "../../../../lib/manuales/oauth";
import { ventaPublica } from "../../../../lib/manuales/pagos";
import { callbackPropio, handle, hoy, mercadoPagoDe, redirectUri } from "../../../../lib/manuales/routes";
import type { ManualesStore } from "../../../../lib/manuales/store";
import type { EstadoManuales, VentaPublica } from "../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

/** What the person can buy online (never blocks the screen: without the sales tables, there is nothing on sale). */
async function venta(store: ManualesStore, email: string): Promise<VentaPublica | null> {
  const mp = mercadoPagoDe();
  if (!mp) return null;
  try {
    const [v, autorizado] = await Promise.all([store.getVenta(), email ? store.getAutorizado(email) : Promise.resolve(null)]);
    return ventaPublica(v, mp.cfg, email, autorizado);
  } catch (err) {
    console.error("[manuales] venta en línea:", err);
    return null;
  }
}

/** Who the caller is, whether they can read the manuals, and (for administrators) the technical account. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ persona, store }) => {
    const { autorizado, motivo, licencia } = await puedeLeer(store, persona.email, async () => persona.esAdmin, hoy());
    const cuenta = await store.getCuenta();
    const oauth = oauthConfig();
    const body: EstadoManuales = {
      usuario: { email: persona.email, nombre: persona.nombre },
      esAdmin: persona.esAdmin,
      autorizado,
      motivo,
      licencia,
      disponible: !!cuenta && !!oauth,
      venta: persona.esAdmin ? null : await venta(store, persona.email),
    };
    if (persona.esAdmin) {
      body.admin = {
        oauthConfigurado: !!oauth,
        redirectUri: redirectUri(),
        manual: redirectUri() !== callbackPropio(req),
        callbackPropio: callbackPropio(req),
        cuenta: cuenta
          ? { nombre: cuenta.cuentaNombre, email: cuenta.cuentaEmail, conectadaPor: cuenta.conectadaPor, conectadaEn: cuenta.conectadaEn, renovadaEn: cuenta.renovadaEn }
          : null,
      };
    }
    return NextResponse.json(body);
  });
}
