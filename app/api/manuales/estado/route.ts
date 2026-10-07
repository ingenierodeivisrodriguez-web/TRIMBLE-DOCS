import { NextRequest, NextResponse } from "next/server";
import { puedeLeer } from "../../../../lib/manuales/acceso";
import { oauthConfig } from "../../../../lib/manuales/oauth";
import { callbackPropio, handle, redirectUri } from "../../../../lib/manuales/routes";
import type { EstadoManuales } from "../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

/** Who the caller is, whether they can read the manuals, and (for administrators) the technical account. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ persona, store }) => {
    const { autorizado } = await puedeLeer(store, persona.email, async () => persona.esAdmin);
    const cuenta = await store.getCuenta();
    const oauth = oauthConfig();
    const body: EstadoManuales = {
      usuario: { email: persona.email, nombre: persona.nombre },
      esAdmin: persona.esAdmin,
      autorizado,
      disponible: !!cuenta && !!oauth,
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
