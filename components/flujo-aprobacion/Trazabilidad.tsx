"use client";

import { useCallback, useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { nombrePdfTrazabilidad, pdfTrazabilidad } from "../../lib/flujo-aprobacion/pdfTrazabilidad";
import { textoEstado } from "../../lib/flujo-aprobacion/registro";
import { FiltroTraza, resumenTraza, Traza } from "../../lib/flujo-aprobacion/trazabilidad";
import type { EstadoArchivo, Flujo } from "../../lib/flujo-aprobacion/types";
import { botonSecundario, card, linkBtn, select, td, texto, th, titulo } from "../compras/estilos";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";

const ESTADOS: EstadoArchivo[] = ["pendiente", "nueva-version", "aprobado", "rechazado", "retirado"];
const pequeno = { padding: "4px 12px", fontSize: 13.5 } as const;

type Resultado = { trazas: Traza[]; filtro: FiltroTraza; hitos: Record<string, string>; por: string };

/** Saves a file from the browser (the presupuesto helper would bring its OmniClass table along). */
function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Traceability (phase 5): for each file, who uploaded each version and when,
 * who reviewed, the decision and its date, comments and reasons, and who copied
 * it to the destination and when. Filters by flow, state, dates and text;
 * everything shown, or one file, exports to PDF.
 */
export default function Trazabilidad({ api, flujos, projectName }: { api: FlujoApi; flujos: Flujo[]; projectName: string }) {
  const [flujoId, setFlujoId] = useState("");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [buscar, setBuscar] = useState("");
  const [datos, setDatos] = useState<Resultado | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await api.trazabilidad({ flujoId, estado, desde, hasta, texto: buscar }));
    } catch (err) {
      setError(message(err));
    } finally {
      setCargando(false);
    }
  }, [api, flujoId, estado, desde, hasta, buscar]);

  useEffect(() => {
    void consultar();
    // Only on opening; afterwards with «Consultar».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportar(trazas: Traza[], clave: string, archivo?: string) {
    if (!datos) return;
    setGenerando(clave);
    try {
      const generado = new Date().toISOString();
      const blob = await pdfTrazabilidad({ trazas, filtro: archivo ? {} : datos.filtro, hitos: new Map(Object.entries(datos.hitos)), proyecto: projectName || "Proyecto", generado, por: datos.por });
      descargar(blob, nombrePdfTrazabilidad(projectName, generado, archivo));
    } catch (err) {
      setError(`No se pudo generar el PDF: ${message(err)}`);
    } finally {
      setGenerando(null);
    }
  }

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section style={{ ...card, maxWidth: 1200 }}>
      <h2 style={titulo}>Trazabilidad</h2>
      <p style={texto}>
        Por cada archivo: quién subió cada versión y cuándo, quién revisó, la decisión y su fecha, los comentarios y motivos, y quién lo copió a la carpeta destino y
        cuándo. Sale del historial, que no se edita ni se borra. Las fechas de subida son las de Trimble.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label>
          <span style={labelStyle}>Flujo</span>
          <select value={flujoId} onChange={(e) => setFlujoId(e.target.value)} style={{ ...select, minWidth: 220 }}>
            <option value="">Todos</option>
            {flujos.map((f) => (
              <option key={f.id} value={f.id}>
                {f.hito}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={select}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {textoEstado({ estado: e, revisionAprobada: null })}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={baseInput} />
        </label>
        <label>
          <span style={labelStyle}>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={baseInput} />
        </label>
        <label>
          <span style={labelStyle}>Buscar</span>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void consultar()} placeholder="Nombre o carpeta" style={{ ...baseInput, width: 200 }} />
        </label>
        <button type="button" onClick={() => void consultar()} disabled={cargando} style={{ ...acceptButton, ...pequeno }}>
          {cargando ? "Consultando…" : "Consultar"}
        </button>
        <button type="button" onClick={() => datos && void exportar(datos.trazas, "todo")} disabled={!datos || !!generando} style={{ ...botonSecundario, ...pequeno }} title="Todo lo que se ve, con los filtros aplicados">
          {generando === "todo" ? "Generando…" : "Exportar PDF"}
        </button>
      </div>
      {(desde || hasta) && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "-6px 0 10px" }}>Con fechas, solo salen los archivos que tuvieron movimientos en esos días, y solo esos movimientos.</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {datos && datos.trazas.length === 0 && <p style={{ ...texto, margin: 0 }}>No hay archivos con estos filtros.</p>}
      {datos && datos.trazas.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {datos.trazas.map((t) => (
            <div key={t.archivo.id} style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14.5, color: "var(--tc-blue-800)" }}>{t.archivo.nombre}</strong>
                <span style={{ display: "inline-flex", gap: 12 }}>
                  <button type="button" style={linkBtn} onClick={() => alternar(t.archivo.id)}>
                    {abiertos.has(t.archivo.id) ? "Ocultar movimientos" : `Ver movimientos (${t.eventos.length})`}
                  </button>
                  <button type="button" style={linkBtn} disabled={!!generando} onClick={() => void exportar([t], t.archivo.id, t.archivo.nombre)}>
                    {generando === t.archivo.id ? "Generando…" : "PDF de este archivo"}
                  </button>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, rowGap: 2, fontSize: 13, marginTop: 4 }}>
                {resumenTraza(t).map((r) => (
                  <div key={r.etiqueta} style={{ display: "contents" }}>
                    <span style={{ color: "var(--tc-gray-500)" }}>{r.etiqueta}</span>
                    <span>{r.valor}</span>
                  </div>
                ))}
              </div>
              {abiertos.has(t.archivo.id) && (
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={th}>Fecha</th>
                        <th style={th}>Quién</th>
                        <th style={th}>Qué</th>
                        <th style={th}>Versión</th>
                        <th style={th}>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.eventos.map((e, i) => (
                        <tr key={i}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{fechaHora(e.fecha)}</td>
                          <td style={td}>{e.quien || "—"}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{e.que}</td>
                          <td style={td}>{e.version ?? ""}</td>
                          <td style={td}>{e.detalle}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>{datos.trazas.length === 1 ? "1 archivo" : `${datos.trazas.length} archivos`}</p>
        </div>
      )}
    </section>
  );
}
