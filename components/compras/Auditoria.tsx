"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComprasApi } from "../../lib/compras/client";
import { detalleEntrada, fechaHora, nombreAccion } from "../../lib/compras/formato";
import { EntradaAuditoria, FiltroAuditoria, MAX_AUDITORIA, MODULOS, ResultadoAuditoria } from "../../lib/compras/types";
import { parseDisplayDate } from "../../lib/propiedades/values";
import { C, labelStyle, message, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonSecundario, etiqueta, select, td, th } from "./estilos";

const RESULTADOS: Record<ResultadoAuditoria, { texto: string; color: string; fondo: string }> = {
  ok: { texto: "Hecho", color: "#2e6b22", fondo: "#e3f3de" },
  denegado: { texto: "Negado", color: "#b3261e", fondo: "#fbe4e2" },
  error: { texto: "Error", color: "#7a5a00", fondo: "#fff4d1" },
};

/** The audit of Compras in this project: read-only, newest first. */
export default function Auditoria({ api, onSinAcceso }: { api: ComprasApi; onSinAcceso: (err: unknown) => void }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultado, setResultado] = useState<ResultadoAuditoria | "">("");
  const [modulo, setModulo] = useState("");
  const [entradas, setEntradas] = useState<EntradaAuditoria[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const desdeIso = desde.trim() ? parseDisplayDate(desde) : null;
  const hastaIso = hasta.trim() ? parseDisplayDate(hasta) : null;
  const fechasMal = (desde.trim() && !desdeIso) || (hasta.trim() && !hastaIso);

  const consultar = useCallback(
    async (antesDe?: number) => {
      if (fechasMal) return;
      setBusy(true);
      setError("");
      const filtro: FiltroAuditoria = {
        ...(desdeIso ? { desde: desdeIso } : {}),
        ...(hastaIso ? { hasta: hastaIso } : {}),
        ...(resultado ? { resultado } : {}),
        ...(modulo ? { modulo } : {}),
        ...(antesDe ? { antesDe } : {}),
        limite: MAX_AUDITORIA,
      };
      try {
        const nuevas = await api.getAuditoria(filtro);
        setEntradas((prev) => (antesDe && prev ? [...prev, ...nuevas] : nuevas));
        setHayMas(nuevas.length === MAX_AUDITORIA);
      } catch (err) {
        setError(message(err));
        onSinAcceso(err);
      } finally {
        setBusy(false);
      }
    },
    [api, desdeIso, hastaIso, resultado, modulo, fechasMal, onSinAcceso]
  );

  useEffect(() => {
    consultar();
    // Only on opening; afterwards with the "Consultar" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <div style={{ width: 170 }}>
          <label style={labelStyle} htmlFor="aud-desde">
            Desde
          </label>
          <DateField id="aud-desde" text={desde} placeholder="DD-MM-AAAA" invalid={!!desde.trim() && !desdeIso} onText={setDesde} />
        </div>
        <div style={{ width: 170 }}>
          <label style={labelStyle} htmlFor="aud-hasta">
            Hasta
          </label>
          <DateField id="aud-hasta" text={hasta} placeholder="DD-MM-AAAA" invalid={!!hasta.trim() && !hastaIso} onText={setHasta} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="aud-resultado">
            Resultado
          </label>
          <select id="aud-resultado" value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoAuditoria | "")} style={select}>
            <option value="">Todos</option>
            <option value="ok">Hecho</option>
            <option value="denegado">Negado</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="aud-modulo">
            Módulo
          </label>
          <select id="aud-modulo" value={modulo} onChange={(e) => setModulo(e.target.value)} style={select}>
            <option value="">Todos</option>
            {MODULOS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => consultar()} disabled={busy || !!fechasMal} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
          {busy ? "Consultando…" : "Consultar"}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Solo lectura: nadie puede cambiar ni borrar estas filas.</span>
      </div>
      {error && <Notice kind="error" style={{ margin: 12 }}>{error}</Notice>}
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 230px)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Fecha y hora</th>
              <th style={th}>Quién</th>
              <th style={th}>Qué</th>
              <th style={th}>A quién / sobre qué</th>
              <th style={th}>Resultado</th>
              <th style={th}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {(entradas ?? []).map((e) => {
              const r = RESULTADOS[e.resultado];
              return (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fechaHora(e.creado)}</td>
                  <td style={td}>{e.actorNombre || e.actorId}</td>
                  <td style={td}>{nombreAccion(e.accion)}</td>
                  <td style={td}>{e.sujetoNombre || (e.objetoTipo === "proyecto" ? "El proyecto" : e.objetoId)}</td>
                  <td style={td}>
                    <span style={etiqueta(r.color, r.fondo)}>{r.texto}</span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{detalleEntrada(e)}</td>
                </tr>
              );
            })}
            {entradas && entradas.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={6}>
                  No hay registros con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hayMas && entradas && (
        <div style={{ padding: 10, textAlign: "center" }}>
          <button type="button" onClick={() => consultar(entradas[entradas.length - 1].id)} disabled={busy} style={botonSecundario}>
            Ver más antiguos
          </button>
        </div>
      )}
    </div>
  );
}
