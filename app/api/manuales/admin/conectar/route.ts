import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, nuevoPkce, oauthConfig } from "../../../../../lib/manuales/oauth";
import { handleAdmin, redirectUri } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** Starts connecting the technical account: returns the Trimble sign-in URL (valid 10 minutes). */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ persona, store }) => {
    const oauth = oauthConfig();
    if (!oauth) {
      throw new ManualesError("Falta la variable TRIMBLE_CLIENT_SECRET en Vercel (el Client Secret de la app \"apibasedatos\").", 503, "sin-oauth");
    }
    const { verifier, challenge, state } = nuevoPkce();
    const uri = redirectUri();
    await store.crearEstado({
      state,
      verifier,
      redirectUri: uri,
      creadoPor: persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre,
      expira: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({ url: authorizeUrl(oauth, uri, state, challenge) });
  });
}
