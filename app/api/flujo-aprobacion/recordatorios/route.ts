import { NextRequest, NextResponse } from "next/server";
import { enviarRecordatorios } from "../../../../lib/flujo-aprobacion/recordatorios";
import { correoDesdeEntorno, urlPublica } from "../../../../lib/flujo-aprobacion/smtp";
import { flujoStore } from "../../../../lib/flujo-aprobacion/store";

export const dynamic = "force-dynamic";

/**
 * The daily reminder of overdue flows (Vercel Cron, see vercel.json; phase 3
 * of the e-mails). With CRON_SECRET set, only Vercel can call it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const correo = correoDesdeEntorno();
    const r = await enviarRecordatorios({
      store: flujoStore(),
      correo,
      origen: urlPublica(null),
      ahora: new Date(),
      idPorDefecto: correo?.idExtension,
    });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[flujo-aprobacion] recordatorios:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error desconocido." }, { status: 500 });
  }
}
