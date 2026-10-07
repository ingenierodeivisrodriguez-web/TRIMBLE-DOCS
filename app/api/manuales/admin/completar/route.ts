import { NextRequest, NextResponse } from "next/server";
import { completarConexion, leerRetorno } from "../../../../../lib/manuales/conexion";
import { oauthConfig } from "../../../../../lib/manuales/oauth";
import { conexionDeps, handleAdmin } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/**
 * `{ enlace }`: the address Trimble Identity sent the browser to after the
 * technical account signed in (http://localhost/?code=...&state=...).
 * Finishes the connection.
 */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store, cfg }) => {
    const body = (await req.json().catch(() => null)) as { enlace?: unknown } | null;
    if (!body || typeof body.enlace !== "string" || !body.enlace.trim() || body.enlace.length > 8000) {
      throw new ManualesError("Pega la dirección completa a la que te llevó Trimble después de iniciar sesión.", 400, "parametro");
    }
    const oauth = oauthConfig();
    if (!oauth) throw new ManualesError("Falta la variable TRIMBLE_CLIENT_SECRET en Vercel.", 503, "sin-oauth");
    return NextResponse.json(await completarConexion(store, oauth, cfg, leerRetorno(body.enlace), conexionDeps()));
  });
}
