"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import { detalleSinAcceso, repartirRevision, textoSinAcceso } from "../../lib/flujo-aprobacion/avisoRevision";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { Flujo, ResumenRevision } from "../../lib/flujo-aprobacion/types";
import { botonSecundario } from "../compras/estilos";
import { message, Notice } from "../presupuesto/ui";

/**
 * Trimble doesn't announce uploads: on opening, the chosen files of every
 * active flow are read (one flow after the other) and new versions are
 * registered; "Revisar ahora" does it again. With nothing new it is one thin
 * line under the dashboard cards (11-11-2026); news and errors keep the notice.
 * Flows where the person's session only missed files it can't see in Trimble
 * (folders without access), with nothing changed, are one more line with
 * «Ver cuáles» (20-11-2026).
 */
export default function RevisionCarpetas({ api, flujos, onTermino }: { api: FlujoApi; flujos: Flujo[]; onTermino: () => void }) {
  const [corriendo, setCorriendo] = useState<{ hito: string; n: number; de: number } | null>(null);
  const [resultados, setResultados] = useState<ResumenRevision[] | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [cuando, setCuando] = useState<string | null>(null);
  const [verSinAcceso, setVerSinAcceso] = useState(false);
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
  const { noticias: conCambios, sinAcceso } = repartirRevision(resultados ?? []);
  const enlace = { border: "none", background: "transparent", color: "var(--tc-blue-700)", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" } as const;
  const lineaSinAcceso = !corriendo && sinAcceso.length > 0 && (
    <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }} title="Normalmente es porque no tienes acceso a esas carpetas en Trimble. Esos archivos los revisa quien sí los ve (por ejemplo, un administrador) cuando abre la extensión.">
      {textoSinAcceso(sinAcceso.length)}{" "}
      <button type="button" onClick={() => setVerSinAcceso((v) => !v)} style={enlace} aria-expanded={verSinAcceso}>
        {verSinAcceso ? "Ocultar" : "Ver cuáles"}
      </button>
    </span>
  );
  const detalleNoLeidos = !corriendo && verSinAcceso && sinAcceso.length > 0 && (
    <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--tc-gray-500)", display: "grid", gap: 2 }}>
      {sinAcceso.map((r) => (
        <li key={r.flujoId}>{detalleSinAcceso(r)}</li>
      ))}
    </ul>
  );
  if (!conCambios.length && !errores.length) {
    return (
      <div style={{ maxWidth: 1100, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 20 }}>
          {corriendo ? (
            <span>
              Revisando versiones nuevas: «{corriendo.hito}» ({corriendo.n} de {corriendo.de})…
            </span>
          ) : (
            <>
              {cuando && <span>Archivos revisados a las {fechaHora(cuando).slice(11)}: no hay versiones nuevas.</span>}
              {lineaSinAcceso}
              <button type="button" onClick={() => void revisar()} style={enlace} title="Busca versiones nuevas de los archivos de cada flujo">
                Revisar ahora
              </button>
            </>
          )}
        </div>
        {detalleNoLeidos}
      </div>
    );
  }
  return (
    <Notice kind={errores.length ? "warning" : "info"} style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: 3 }}>
          {corriendo && (
            <span>
              Revisando los archivos de «{corriendo.hito}»… ({corriendo.n} de {corriendo.de})
            </span>
          )}
          {!corriendo && resultados && conCambios.length === 0 && errores.length === 0 && <span>Archivos revisados: no hay versiones nuevas.</span>}
          {!corriendo && conCambios.map((r) => <span key={r.flujoId}>{r.mensaje}</span>)}
          {!corriendo && errores.map((t) => <span key={t}>No se pudo revisar {t}</span>)}
          {lineaSinAcceso}
          {detalleNoLeidos}
        </div>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          {cuando && !corriendo && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Revisado a las {fechaHora(cuando).slice(11)}</span>}
          <button type="button" onClick={() => void revisar()} disabled={!!corriendo} style={{ ...botonSecundario, padding: "4px 12px", fontSize: 13.5 }} title="Busca versiones nuevas de los archivos de cada flujo">
            {corriendo ? "Revisando…" : "Revisar ahora"}
          </button>
        </span>
      </div>
    </Notice>
  );
}
