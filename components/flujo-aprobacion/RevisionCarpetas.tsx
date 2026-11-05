"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { Flujo, ResumenRevision } from "../../lib/flujo-aprobacion/types";
import { botonSecundario } from "../compras/estilos";
import { message, Notice } from "../presupuesto/ui";

/**
 * Trimble doesn't announce uploads: on opening, the review folders of every
 * active flow are walked (one flow after the other) and what changed is
 * registered; "Revisar ahora" does it again.
 */
export default function RevisionCarpetas({ api, flujos, onTermino }: { api: FlujoApi; flujos: Flujo[]; onTermino: () => void }) {
  const [corriendo, setCorriendo] = useState<{ hito: string; n: number; de: number } | null>(null);
  const [resultados, setResultados] = useState<ResumenRevision[] | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [cuando, setCuando] = useState<string | null>(null);
  const hecho = useRef(false);
  const activos = flujos.filter((f) => f.activo);
  const ids = activos.map((f) => f.id).join(",");

  const revisar = useCallback(async () => {
    const lista = flujos.filter((f) => f.activo);
    const out: ResumenRevision[] = [];
    const fallas: string[] = [];
    for (const [i, f] of lista.entries()) {
      setCorriendo({ hito: f.hito, n: i + 1, de: lista.length });
      try {
        out.push(await api.revisar(f.id));
      } catch (err) {
        fallas.push(`«${f.hito}»: ${message(err)}`);
      }
    }
    setCorriendo(null);
    setResultados(out);
    setErrores(fallas);
    setCuando(new Date().toISOString());
    onTermino();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ids]);

  useEffect(() => {
    if (hecho.current || !ids) return;
    hecho.current = true;
    void revisar();
  }, [ids, revisar]);

  if (!activos.length) return null;
  const conCambios = (resultados ?? []).filter((r) => r.nuevos || r.nuevasVersiones || r.retirados || r.reaparecidos || !r.completo || r.ocupado || /no apareci/.test(r.mensaje));
  return (
    <Notice kind={errores.length ? "warning" : "info"} style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: 3 }}>
          {corriendo && (
            <span>
              Revisando las carpetas de «{corriendo.hito}»… ({corriendo.n} de {corriendo.de})
            </span>
          )}
          {!corriendo && resultados && conCambios.length === 0 && errores.length === 0 && <span>Carpetas revisadas: no hay archivos ni versiones nuevas.</span>}
          {!corriendo && conCambios.map((r) => <span key={r.flujoId}>{r.mensaje}</span>)}
          {!corriendo && errores.map((t) => <span key={t}>No se pudo revisar {t}</span>)}
        </div>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          {cuando && !corriendo && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Revisado a las {fechaHora(cuando).slice(11)}</span>}
          <button type="button" onClick={() => void revisar()} disabled={!!corriendo} style={{ ...botonSecundario, padding: "4px 12px", fontSize: 13.5 }} title="Busca archivos y versiones nuevas en las carpetas de revisión">
            {corriendo ? "Revisando…" : "Revisar ahora"}
          </button>
        </span>
      </div>
    </Notice>
  );
}
