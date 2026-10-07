import { NextRequest } from "next/server";
import { olvidarToken } from "../../../../../lib/manuales/acceso";
import { configManuales } from "../../../../../lib/manuales/config";
import { canjearCodigo, cifrar, oauthConfig, revocar } from "../../../../../lib/manuales/oauth";
import { olvidarBiblioteca, tcCon } from "../../../../../lib/manuales/routes";
import { abrirBiblioteca, ManualesError } from "../../../../../lib/manuales/service";
import { manualesStore } from "../../../../../lib/manuales/store";
import { getCurrentUser } from "../../../../../lib/trimbleApi";

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
 * Trimble Identity's callback after the technical account signs in: trades
 * the code for tokens, checks the account can open the manuals folder, and
 * keeps its session (encrypted).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return pagina(false, "No se conectó la cuenta", q.get("error_description") || q.get("error") || "Trimble Identity canceló el inicio de sesión.");
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state) return pagina(false, "Enlace incompleto", "Vuelve a Manuales y pulsa otra vez \"Conectar cuenta técnica\".");
  const oauth = oauthConfig();
  const cfg = configManuales();
  if (!oauth || !cfg) return pagina(false, "Falta configuración", "Falta TRIMBLE_CLIENT_SECRET en Vercel o la carpeta de manuales no está bien indicada.");
  try {
    const store = manualesStore();
    const estado = await store.consumirEstado(state);
    if (!estado) return pagina(false, "El enlace venció", "Han pasado más de 10 minutos o el enlace ya se usó. Vuelve a Manuales y pulsa otra vez \"Conectar cuenta técnica\".");
    const tokens = await canjearCodigo(oauth, code, estado.redirectUri, estado.verifier);
    let abierta;
    try {
      abierta = await abrirBiblioteca(tcCon(tokens.accessToken), cfg);
    } catch (err) {
      await revocar(oauth, tokens.refreshToken);
      if (err instanceof ManualesError && err.code === "sin-acceso") {
        return pagina(
          false,
          "Esa cuenta no tiene acceso a los manuales",
          "La cuenta con la que entraste no es miembro de MANAGER PROJECT o no tiene permiso sobre la carpeta de manuales. Invítala con permiso de lectura y vuelve a conectar."
        );
      }
      throw err;
    }
    const me = await getCurrentUser(abierta.baseUrl, tokens.accessToken);
    await store.guardarCuenta({
      refreshCifrado: cifrar(tokens.refreshToken, oauth.secret),
      accessCifrado: cifrar(tokens.accessToken, oauth.secret),
      accessExpira: new Date(tokens.expiresAt).toISOString(),
      cuentaId: me.id,
      cuentaNombre: [me.firstName, me.lastName].filter(Boolean).join(" ").trim(),
      cuentaEmail: me.email ?? "",
      conectadaPor: estado.creadoPor || null,
    });
    olvidarToken();
    olvidarBiblioteca();
    return pagina(true, "Cuenta técnica conectada", `Manuales leerá «${abierta.biblioteca.carpetaNombre}» con la cuenta ${me.email ?? me.id}. Ya puedes cerrar esta pestaña y volver a Trimble Connect.`);
  } catch (err) {
    console.error("[manuales] conexión de la cuenta técnica:", err);
    return pagina(false, "No se pudo conectar la cuenta", err instanceof Error ? err.message : "Error desconocido.");
  }
}
