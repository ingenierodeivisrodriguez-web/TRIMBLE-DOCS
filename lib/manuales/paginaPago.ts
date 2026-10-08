// The page buyers land on in the gateway's tab after paying (Mercado Pago
// and Wompi send them back to it).
import { fechaVisible } from "./licencia";
import { NOMBRE_PASARELA } from "./pasarelas";
import { textoEstadoPago } from "./textos";
import type { Orden } from "./types";

function escapar(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type Tono = "ok" | "espera" | "error";

export function paginaPago(tono: Tono, titulo: string, texto: string): Response {
  const color = tono === "ok" ? "#1d6b2f" : tono === "espera" ? "#8a5300" : "#8a1c14";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Manuales</title>
<style>body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f4f9fd;color:#3c4550;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.c{max-width:480px;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(10,61,98,.12);padding:28px;text-align:center}
h1{font-size:20px;margin:0 0 10px;color:${color}}p{font-size:15px;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const VOLVER = "Ya puedes cerrar esta pestaña y volver a Trimble Connect: Manuales se abrirá solo.";

/** What the buyer reads about their purchase. */
export function paginaDeOrden(o: Orden | null): Response {
  if (!o) return paginaPago("error", "No encontramos esta compra", "Vuelve a Trimble Connect y abre Manuales de nuevo.");
  if (o.estado === "aprobada") {
    return paginaPago(
      "ok",
      "¡Pago aprobado!",
      `${o.venceNueva ? `Tu acceso a los manuales quedó activo hasta el ${fechaVisible(o.venceNueva)}.` : "Tu acceso a los manuales está activo."} ${VOLVER}`
    );
  }
  if (o.estado === "revisar") return paginaPago("espera", "Recibimos tu pago", "El administrador de los manuales debe revisarlo antes de activar tu acceso.");
  if (o.estado === "reembolsada") return paginaPago("error", "Pago reembolsado", "Este pago fue reembolsado.");
  if (!o.estadoPago || o.estadoPago === "rejected" || o.estadoPago === "cancelled") {
    return paginaPago(
      "error",
      o.estadoPago ? textoEstadoPago(o.estadoPago, o.detallePago) : "No se completó el pago",
      "Vuelve a Trimble Connect para intentarlo de nuevo, con otro medio de pago si hace falta."
    );
  }
  return paginaPago(
    "espera",
    textoEstadoPago(o.estadoPago, o.detallePago),
    `Cuando ${NOMBRE_PASARELA[o.pasarela]} lo apruebe, tu acceso a los manuales se activará solo. Puedes cerrar esta pestaña.`
  );
}
