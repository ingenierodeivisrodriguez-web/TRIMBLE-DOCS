import { NextRequest, NextResponse } from "next/server";
import { olvidarToken } from "../../../../../lib/manuales/acceso";
import { descifrar, oauthConfig, revocar } from "../../../../../lib/manuales/oauth";
import { handleAdmin, olvidarBiblioteca } from "../../../../../lib/manuales/routes";

export const dynamic = "force-dynamic";

/** Disconnects the technical account (its session is revoked at Trimble Identity). */
export async function DELETE(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const cuenta = await store.getCuenta();
    const oauth = oauthConfig();
    if (cuenta && oauth) {
      try {
        await revocar(oauth, descifrar(cuenta.refreshCifrado, oauth.secret));
      } catch {
        // Unreadable or already invalid: nothing to revoke.
      }
    }
    await store.borrarCuenta();
    olvidarToken();
    olvidarBiblioteca();
    return NextResponse.json({ ok: true });
  });
}
