import { NextRequest, NextResponse } from "next/server";
import { mantenerSesion } from "../../../../lib/manuales/acceso";
import { cuentaDeps } from "../../../../lib/manuales/routes";
import { manualesStore } from "../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

/**
 * Daily keep-alive (Vercel Cron, see vercel.json): renews the technical
 * account's session when its last renewal is old, since Trimble asks to
 * renew at least every 9 days. With CRON_SECRET set, only Vercel can call it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    return NextResponse.json({ resultado: await mantenerSesion(manualesStore(), cuentaDeps()) });
  } catch (err) {
    console.error("[manuales] mantener la sesión:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
