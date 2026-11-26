// TEMPORARY (Inspección 360°, Fase 0): relays a request to a Trimble Connect API with the user's
// own token, so the test page can discover the BCF Topics service (its base URL is not published)
// and read project data for checklist T0.1. Only https hosts under connect.trimble.com, only GET and
// POST, and nothing is stored. Remove when Fase 0 closes.
import { destinoPermitido } from "../../../../lib/i360-pruebas/destino";

export const dynamic = "force-dynamic";

const MAX_CUERPO = 20000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return Response.json({ error: "Falta el token de Trimble." }, { status: 401 });
  let entrada: { metodo?: unknown; url?: unknown; cuerpo?: unknown };
  try {
    entrada = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  const metodo = entrada.metodo === "POST" ? "POST" : entrada.metodo === "GET" ? "GET" : null;
  const url = typeof entrada.url === "string" ? destinoPermitido(entrada.url) : null;
  if (!metodo || !url) return Response.json({ error: "Solo GET o POST a https://*.connect.trimble.com." }, { status: 400 });

  const inicio = Date.now();
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: metodo === "POST" ? JSON.stringify(entrada.cuerpo ?? {}) : undefined,
      cache: "no-store",
      redirect: "manual",
    });
    const texto = await res.text();
    let cuerpo: unknown = texto.slice(0, MAX_CUERPO);
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // not JSON: keep the (truncated) text
    }
    return Response.json({
      estado: res.status,
      tipo: res.headers.get("content-type") ?? "",
      ubicacion: res.headers.get("location") ?? "",
      ms: Date.now() - inicio,
      cuerpo,
    });
  } catch (err) {
    return Response.json({ estado: 0, error: err instanceof Error ? err.message : "Error de red", ms: Date.now() - inicio });
  }
}
