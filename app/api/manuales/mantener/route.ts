import { NextRequest, NextResponse } from "next/server";
import { mantenerSesion } from "../../../../lib/manuales/acceso";
import { conciliarPendientes } from "../../../../lib/manuales/pagos";
import { cuentaDeps, hoy, mercadoPagoDe } from "../../../../lib/manuales/routes";
import { manualesStore } from "../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

/**
 * Daily keep-alive (Vercel Cron, see vercel.json): renews the technical
 * account's session when its last renewal is old, since Trimble asks to
 * renew at least every 9 days; and checks against Mercado Pago the
 * purchases of the last days still pending (in case a notification was
 * lost). With CRON_SECRET set, only Vercel can call it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const store = manualesStore();
  let pagos: { revisadas: number; aprobadas: number } | { error: string } | null = null;
  const mp = mercadoPagoDe();
  if (mp) {
    try {
      pagos = await conciliarPendientes(store, mp.mp, hoy());
    } catch (err) {
      console.error("[manuales] revisar compras pendientes:", err);
      pagos = { error: err instanceof Error ? err.message : "Error desconocido." };
    }
  }
  try {
    return NextResponse.json({ resultado: await mantenerSesion(store, cuentaDeps()), ...(pagos ? { pagos } : {}) });
  } catch (err) {
    console.error("[manuales] mantener la sesión:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido.", ...(pagos ? { pagos } : {}) }, { status: 500 });
  }
}
