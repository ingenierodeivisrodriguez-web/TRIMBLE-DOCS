// TEMPORARY (Inspección 360°, Fase 0). Where the test relay may send the user's token: only https
// hosts under connect.trimble.com. Remove when Fase 0 closes.

export function destinoPermitido(texto: string): URL | null {
  try {
    const url = new URL(texto);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    return host === "connect.trimble.com" || host.endsWith(".connect.trimble.com") ? url : null;
  } catch {
    return null;
  }
}

/** Base URLs worth trying for the BCF Topics service, from the project's /regions entry (not guessed). */
export function candidatosBcf(region: Record<string, unknown>): { clave: string; base: string }[] {
  const salida: { clave: string; base: string }[] = [];
  const visto = new Set<string>();
  for (const [clave, valor] of Object.entries(region)) {
    if (typeof valor !== "string" || !destinoPermitido(valor)) continue;
    const limpio = valor.replace(/\/+$/, "");
    // A value that already names a BCF version path is cut back to its root ("…/bcf/2.1" → "…").
    const base = /\/bcf(\/[\d.]+)?$/i.test(limpio) ? limpio.replace(/\/bcf(\/[\d.]+)?$/i, "") : limpio;
    const prioridad = /bcf|topic/i.test(clave);
    if (!prioridad) continue;
    if (!visto.has(base)) {
      visto.add(base);
      salida.push({ clave, base });
    }
  }
  return salida;
}
