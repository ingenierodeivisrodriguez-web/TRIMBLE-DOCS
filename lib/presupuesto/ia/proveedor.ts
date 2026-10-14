// Which model provider the assistant uses: Anthropic (Claude) or Google
// (Gemini, AI Studio). Chosen with Vercel variables; the rest of the app
// doesn't know which one answers.
import { clienteClaude, ClienteIA, MODELO_POR_DEFECTO } from "./claude";
import { clienteGemini, MODELO_GEMINI_POR_DEFECTO, MODELO_GEMINI_RESPALDO } from "./gemini";

export type Proveedor = "anthropic" | "google";

type Env = Record<string, string | undefined>;

/**
 * PRESUPUESTO_IA_PROVEEDOR ("anthropic" or "google") decides; otherwise the
 * model's name (PRESUPUESTO_IA_MODELO "claude-..." or "gemini-..."); otherwise
 * whichever key is set (Anthropic first). null: none configured.
 */
export function elegirProveedor(env: Env): { proveedor: Proveedor; apiKey: string; modelo: string } | null {
  const claves: Record<Proveedor, string | undefined> = {
    anthropic: env.ANTHROPIC_API_KEY?.trim(),
    google: (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)?.trim(),
  };
  const modelo = env.PRESUPUESTO_IA_MODELO?.trim() || "";
  const pedido = env.PRESUPUESTO_IA_PROVEEDOR?.trim().toLowerCase();
  const proveedor: Proveedor | null =
    pedido === "google" || pedido === "anthropic"
      ? pedido
      : modelo.startsWith("gemini")
        ? "google"
        : modelo.startsWith("claude")
          ? "anthropic"
          : claves.anthropic
            ? "anthropic"
            : claves.google
              ? "google"
              : null;
  if (!proveedor) return null;
  const apiKey = claves[proveedor];
  if (!apiKey) return null;
  const propio = proveedor === "google" ? modelo.startsWith("gemini") : modelo.startsWith("claude");
  return { proveedor, apiKey, modelo: propio ? modelo : proveedor === "google" ? MODELO_GEMINI_POR_DEFECTO : MODELO_POR_DEFECTO };
}

/** The client of the configured provider, or null. */
export function clienteIA(env: Env = process.env): ClienteIA | null {
  const p = elegirProveedor(env);
  if (!p) return null;
  if (p.proveedor === "anthropic") return clienteClaude(p.apiKey, p.modelo);
  // PRESUPUESTO_IA_MODELO_RESPALDO changes Google's backup model; "no" turns it off.
  const respaldo = env.PRESUPUESTO_IA_MODELO_RESPALDO?.trim();
  return clienteGemini(p.apiKey, p.modelo, respaldo === "no" ? null : respaldo || MODELO_GEMINI_RESPALDO);
}
