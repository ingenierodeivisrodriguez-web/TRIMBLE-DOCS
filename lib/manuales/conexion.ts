// Finishing the technical account's connection: Trimble Identity sends the
// browser back with a one-time code, either to this app's callback URL or, when
// the Trimble app only accepts http://localhost (external developers can't
// edit apps in Trimble's console), to a page that doesn't load; then the
// administrator pastes that address in Manuales.
import { olvidarToken } from "./acceso";
import type { ConfigManuales } from "./config";
import { cifrar, OauthConfig, Tokens } from "./oauth";
import { Abierta, abrirBiblioteca, ManualesError, Tc } from "./service";
import type { ManualesStore } from "./store";

export interface Resultado {
  ok: boolean;
  titulo: string;
  texto: string;
}

export interface ConexionDeps {
  canjear(cfg: OauthConfig, code: string, redirectUri: string, verifier: string): Promise<Tokens>;
  revocar(cfg: OauthConfig, refreshToken: string): Promise<void>;
  tc(accessToken: string): Tc;
  usuario(baseUrl: string, accessToken: string): Promise<{ id: string; email?: string; firstName?: string; lastName?: string }>;
  /** Forget what this instance cached about the previous account. */
  olvidar(): void;
}

/** The code, state or error Trimble Identity put in the address it sent the browser to. */
export function leerRetorno(enlace: string): { code: string | null; state: string | null; error: string | null } {
  const texto = enlace.trim();
  let params: URLSearchParams;
  try {
    params = new URL(texto).searchParams;
  } catch {
    const q = texto.indexOf("?");
    params = new URLSearchParams(q >= 0 ? texto.slice(q + 1) : texto);
  }
  const error = params.get("error");
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: error ? params.get("error_description") || error : null,
  };
}

export async function completarConexion(
  store: ManualesStore,
  oauth: OauthConfig,
  cfg: ConfigManuales,
  retorno: { code: string | null; state: string | null; error: string | null },
  deps: ConexionDeps
): Promise<Resultado> {
  if (retorno.error) return { ok: false, titulo: "No se conectó la cuenta", texto: retorno.error };
  if (!retorno.code || !retorno.state) {
    return { ok: false, titulo: "Enlace incompleto", texto: "La dirección no trae el código de Trimble: copia la dirección completa de la barra (empieza por http://localhost/?code=...)." };
  }
  const estado = await store.consumirEstado(retorno.state);
  if (!estado) {
    return {
      ok: false,
      titulo: "El enlace venció",
      texto: "Pasaron más de 10 minutos o ese enlace ya se usó. Pulsa otra vez \"Conectar cuenta técnica\" y repite el inicio de sesión.",
    };
  }
  const tokens = await deps.canjear(oauth, retorno.code, estado.redirectUri, estado.verifier);
  let abierta: Abierta;
  try {
    abierta = await abrirBiblioteca(deps.tc(tokens.accessToken), cfg);
  } catch (err) {
    await deps.revocar(oauth, tokens.refreshToken);
    if (err instanceof ManualesError && err.code === "sin-acceso") {
      return {
        ok: false,
        titulo: "Esa cuenta no tiene acceso a los manuales",
        texto: "La cuenta con la que entraste no es miembro de MANAGER PROJECT o no tiene permiso sobre la carpeta de manuales. Invítala con permiso de lectura y vuelve a conectar.",
      };
    }
    throw err;
  }
  const me = await deps.usuario(abierta.baseUrl, tokens.accessToken);
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
  deps.olvidar();
  return {
    ok: true,
    titulo: "Cuenta técnica conectada",
    texto: `Manuales leerá «${abierta.biblioteca.carpetaNombre}» con la cuenta ${me.email ?? me.id}.`,
  };
}
