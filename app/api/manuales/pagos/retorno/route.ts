import { NextRequest } from "next/server";
import { fechaVisible } from "../../../../../lib/manuales/licencia";
import { esOrden, procesarPago, verificarOrden } from "../../../../../lib/manuales/pagos";
import { hoy, mercadoPagoDe } from "../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../lib/manuales/store";
import { textoEstadoMp } from "../../../../../lib/manuales/textos";
import type { Orden } from "../../../../../lib/manuales/types";

export const dynamic = "force-dynamic";

function escapar(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Tono = "ok" | "espera" | "error";

/** The page the buyer lands on in Mercado Pago's tab. */
function pagina(tono: Tono, titulo: string, texto: string): Response {
  const color = tono === "ok" ? "#1d6b2f" : tono === "espera" ? "#8a5300" : "#8a1c14";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Manuales</title>
<style>body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f4f9fd;color:#3c4550;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.c{max-width:480px;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(10,61,98,.12);padding:28px;text-align:center}
h1{font-size:20px;margin:0 0 10px;color:${color}}p{font-size:15px;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const VOLVER = "Ya puedes cerrar esta pestaña y volver a Trimble Connect: Manuales se abrirá solo.";

function deOrden(o: Orden | null): Response {
  if (!o) return pagina("error", "No encontramos esta compra", "Vuelve a Trimble Connect y abre Manuales de nuevo.");
  if (o.estado === "aprobada") {
    return pagina("ok", "¡Pago aprobado!", `${o.venceNueva ? `Tu acceso a los manuales quedó activo hasta el ${fechaVisible(o.venceNueva)}.` : "Tu acceso a los manuales está activo."} ${VOLVER}`);
  }
  if (o.estado === "revisar") return pagina("espera", "Recibimos tu pago", "El administrador de los manuales debe revisarlo antes de activar tu acceso.");
  if (o.estado === "reembolsada") return pagina("error", "Pago reembolsado", "Este pago fue reembolsado.");
  if (!o.estadoMp || o.estadoMp === "rejected" || o.estadoMp === "cancelled") {
    return pagina("error", o.estadoMp ? textoEstadoMp(o.estadoMp, o.detalleMp) : "No se completó el pago", "Vuelve a Trimble Connect para intentarlo de nuevo, con otro medio de pago si hace falta.");
  }
  return pagina("espera", textoEstadoMp(o.estadoMp, o.detalleMp), "Cuando Mercado Pago lo apruebe, tu acceso a los manuales se activará solo. Puedes cerrar esta pestaña.");
}

/**
 * Mercado Pago's return (back_urls): `?payment_id=&status=&external_reference=`.
 * The payment is read from Mercado Pago and applied right away, so the
 * license opens even before its notification arrives.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mp = mercadoPagoDe();
  if (!mp) return pagina("error", "Pago no disponible", "La compra en línea no está configurada.");
  const store = manualesStore();
  const pagoId = q.get("payment_id") ?? q.get("collection_id");
  const referencia = q.get("external_reference");
  try {
    if (pagoId && /^\d{1,20}$/.test(pagoId)) {
      const r = await procesarPago(store, mp.mp, pagoId, hoy());
      if (r.resultado === "ajeno" || !r.orden) return pagina("error", "No encontramos esta compra", "Si pagaste, escribe al administrador de los manuales con el número de tu pago en Mercado Pago.");
      return deOrden(await store.getOrden(r.orden));
    }
    if (esOrden(referencia)) {
      const o = await store.getOrden(referencia);
      return deOrden(o ? await verificarOrden(store, mp.mp, o, hoy()) : null);
    }
    return pagina("error", "No se completó el pago", "Vuelve a Trimble Connect para intentarlo de nuevo.");
  } catch (err) {
    console.error("[manuales] retorno de Mercado Pago:", err);
    return pagina("espera", "No pudimos confirmar el pago todavía", "Si pagaste, tu acceso se activará solo en unos minutos, cuando Mercado Pago lo confirme.");
  }
}
