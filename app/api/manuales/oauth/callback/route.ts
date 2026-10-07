import { NextRequest } from "next/server";
import { configManuales } from "../../../../../lib/manuales/config";
import { completarConexion, leerRetorno } from "../../../../../lib/manuales/conexion";
import { oauthConfig } from "../../../../../lib/manuales/oauth";
import { conexionDeps } from "../../../../../lib/manuales/routes";
import { manualesStore } from "../../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

function escapar(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The page shown in the sign-in tab once Trimble Identity sends the account back. */
function pagina(ok: boolean, titulo: string, texto: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Manuales</title>
<style>body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f4f9fd;color:#3c4550;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.c{max-width:480px;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(10,61,98,.12);padding:28px;text-align:center}
h1{font-size:20px;margin:0 0 10px;color:${ok ? "#1d6b2f" : "#8a1c14"}}p{font-size:15px;line-height:1.5;margin:0}</style></head>
<body><div class="c"><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Trimble Identity's callback, when this URL is registered in the Trimble app
 * (MANUALES_REDIRECT_URI): completes the technical account's connection by
 * itself. Otherwise the administrator pastes the address in Manuales.
 */
export async function GET(req: NextRequest) {
  const oauth = oauthConfig();
  const cfg = configManuales();
  if (!oauth || !cfg) return pagina(false, "Falta configuración", "Falta TRIMBLE_CLIENT_SECRET en Vercel o la carpeta de manuales no está bien indicada.");
  try {
    const r = await completarConexion(manualesStore(), oauth, cfg, leerRetorno(req.nextUrl.toString()), conexionDeps());
    return pagina(r.ok, r.titulo, r.ok ? `${r.texto} Ya puedes cerrar esta pestaña y volver a Trimble Connect.` : r.texto);
  } catch (err) {
    console.error("[manuales] conexión de la cuenta técnica:", err);
    return pagina(false, "No se pudo conectar la cuenta", err instanceof Error ? err.message : "Error desconocido.");
  }
}
