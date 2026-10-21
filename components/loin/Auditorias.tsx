"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { comparar, desdeGuardado } from "../../lib/loin/auditoria";
import type { LoinApi } from "../../lib/loin/client";
import { exportarAuditoriaExcel, exportarAuditoriaPdf, imagenesParaPdf } from "../../lib/loin/exportarAuditoria";
import { etapasOrdenadas, fechaCorta } from "../../lib/loin/matriz";
import type { Auditoria, ElementosResponse, EstadoResponse, Etapa, Excepcion, Parametro } from "../../lib/loin/types";
import { fecha } from "../../lib/presupuesto/format";
import { acceptButton, C, message, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, campo, etiqueta, inactivo, linkBtn, select, td, th } from "./estilos";
import VistaResumenAuditoria, { BarraPct } from "./VistaResumenAuditoria";

type Seccion = "historial" | "excepciones";

/** The saved audits (history, evolution, comparison, reports) and the accepted exceptions. */
export default function Auditorias({ api, estado, parametros }: { api: LoinApi; estado: EstadoResponse; parametros: Parametro[] }) {
  const [auditorias, setAuditorias] = useState<Auditoria[] | null>(null);
  const [excepciones, setExcepciones] = useState<Excepcion[]>([]);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [elems, setElems] = useState<ElementosResponse | null>(null);
  const [error, setError] = useState("");
  const [seccion, setSeccion] = useState<Seccion>("historial");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [a, x, m, e] = await Promise.all([api.getAuditorias(), api.getExcepciones(), api.getMatriz(), api.getElementos()]);
      setAuditorias(a);
      setExcepciones(x);
      setEtapas(etapasOrdenadas(m.etapas, true));
      setElems(e);
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) {
    return (
      <Notice kind="error">
        {error}{" "}
        <button type="button" style={linkBtn} onClick={cargar}>
          Reintentar
        </button>
      </Notice>
    );
  }
  if (!auditorias || !elems) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando auditorías…</p>;
  const vigentes = excepciones.filter((x) => x.activa).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.border}` }}>
        {(
          [
            ["historial", `Historial (${auditorias.length})`],
            ["excepciones", `Excepciones (${vigentes} ${vigentes === 1 ? "vigente" : "vigentes"})`],
          ] as [Seccion, string][]
        ).map(([id, nombre]) => (
          <button key={id} type="button" onClick={() => setSeccion(id)} style={subtab(id === seccion)}>
            {nombre}
          </button>
        ))}
      </div>
      {seccion === "historial" && <Historial api={api} auditorias={auditorias} etapas={etapas} elems={elems} />}
      {seccion === "excepciones" && (
        <Excepciones api={api} puede={estado.canEdit} excepciones={excepciones} etapas={etapas} elems={elems} parametros={parametros} onCambio={(x) => setExcepciones((l) => l.map((y) => (y.id === x.id ? x : y)))} />
      )}
    </div>
  );
}

function Historial({ api, auditorias, etapas, elems }: { api: LoinApi; auditorias: Auditoria[]; etapas: Etapa[]; elems: ElementosResponse }) {
  const [etapaId, setEtapaId] = useState(() => auditorias[0]?.etapaId ?? "");
  const [elegida, setElegida] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const delaEtapa = useMemo(() => auditorias.filter((a) => !etapaId || a.etapaId === etapaId), [auditorias, etapaId]);
  const completas = delaEtapa.filter((a) => a.estado === "completa");
  const actual = auditorias.find((a) => a.id === elegida) ?? null;
  const anterior = actual ? completas.find((a) => a.etapaId === actual.etapaId && a.creada < actual.creada) ?? null : null;
  const nombreEtapa = (id: string) => etapas.find((e) => e.id === id)?.nombre ?? "(etapa)";

  // One point per audit (oldest first), one line per discipline plus the total.
  const { puntos, series } = useMemo(() => {
    const orden = [...completas].reverse();
    const series = new Map<string, { nombre: string; color: string }>();
    const puntos = orden.map((a) => {
      const p: Record<string, number | string> = { fecha: fecha(a.creada).slice(0, 16), Total: a.resumen.total.pct };
      for (const d of a.resumen.disciplinas) {
        series.set(d.id, { nombre: `${d.codigo} · ${d.nombre}`, color: d.color });
        p[d.id] = d.totales.pct;
      }
      return p;
    });
    return { puntos, series };
  }, [completas]);

  async function exportar(a: Auditoria, tipo: "excel" | "pdf") {
    setBusy(tipo === "excel" ? "Preparando el Excel…" : "Preparando el PDF…");
    setError("");
    try {
      const { lotes } = await api.getAuditoria(a.id);
      const informe = desdeGuardado(a.resumen, lotes);
      const emitida = fechaCorta(a.creada.slice(0, 10));
      if (tipo === "excel") await exportarAuditoriaExcel(informe, emitida);
      else {
        const urls = new Map<string, string>();
        for (const e of informe.elementos) {
          const img = elems.imagenes.find((i) => i.elementoId === e.id && i.url);
          if (img) urls.set(e.id, img.url);
        }
        await exportarAuditoriaPdf(informe, await imagenesParaPdf(urls), emitida);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }

  if (auditorias.length === 0) {
    return <Notice kind="info">Todavía no hay auditorías guardadas. Se hacen en el visor 3D: panel Requisitos BIM → Auditoría → Auditar → Guardar auditoría.</Notice>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} style={select} aria-label="Etapa">
          <option value="">Todas las etapas</option>
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        {busy && <span style={ayuda}>{busy}</span>}
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <section style={tarjeta}>
        <strong style={{ fontSize: 14, color: "var(--tc-blue-800)" }}>Evolución del cumplimiento{etapaId ? ` · ${nombreEtapa(etapaId)}` : ""}</strong>
        {!etapaId && <p style={ayuda}>Elige una etapa: la evolución compara auditorías de la misma etapa.</p>}
        {etapaId && puntos.length < 2 && <p style={ayuda}>Con dos auditorías completas o más de esta etapa se ve la evolución.</p>}
        {etapaId && puntos.length >= 2 && (
          <div style={{ height: 260, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={puntos} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#e8ecf1" vertical={false} />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit=" %" width={52} />
                <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toLocaleString("es")} %` : `${v ?? ""} %`)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Total" stroke="#1f2328" strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
                {[...series].map(([id, s]) => (
                  <Line key={id} type="monotone" dataKey={id} name={s.nombre} stroke={s.color} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div style={{ overflow: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Fecha</th>
              <th style={th}>Etapa</th>
              <th style={th}>Disciplinas</th>
              <th style={th}>Modelos (versión)</th>
              <th style={{ ...th, width: 180 }}>Cumplimiento</th>
              <th style={th}>✓ / ◐ / ✗</th>
              <th style={th}>Autor</th>
              <th style={th}>Nota</th>
            </tr>
          </thead>
          <tbody>
            {delaEtapa.map((a) => (
              <tr key={a.id} onClick={() => setElegida(a.id === elegida ? null : a.id)} style={{ cursor: "pointer", background: a.id === elegida ? C.rowSelected : undefined }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {fecha(a.creada)} {a.estado !== "completa" && <span style={inactivo}>Incompleta</span>}
                </td>
                <td style={td}>{a.resumen.etapa.nombre}</td>
                <td style={td}>{a.resumen.disciplinas.map((d) => d.codigo).join(", ")}</td>
                <td style={{ ...td, fontSize: 12.5 }}>{a.resumen.modelos.map((m) => `${m.nombre}${m.versionId ? ` (${m.versionId.slice(0, 8)})` : ""}`).join(", ")}</td>
                <td style={td}>
                  <BarraPct pct={a.resumen.total.pct} umbral={a.resumen.umbralAmarillo} />
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {a.resumen.total.cumple} / {a.resumen.total.parcial} / {a.resumen.total.noCumple}
                </td>
                <td style={td}>{a.creadaPor ?? ""}</td>
                <td style={{ ...td, fontSize: 12.5 }}>{a.nota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {actual && (
        <section style={tarjeta}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <strong style={{ fontSize: 14, color: "var(--tc-blue-800)" }}>
              {actual.resumen.etapa.nombre} · {fecha(actual.creada)}
            </strong>
            <span style={ayuda}>Umbral del amarillo: {actual.resumen.umbralAmarillo} % (el de ese momento)</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={botonSecundario} disabled={!!busy || actual.estado !== "completa"} onClick={() => exportar(actual, "excel")}>
              Exportar Excel
            </button>
            <button type="button" style={botonSecundario} disabled={!!busy || actual.estado !== "completa"} onClick={() => exportar(actual, "pdf")}>
              Exportar PDF
            </button>
          </div>
          {actual.estado !== "completa" && <Notice kind="warning">Esta auditoría no se terminó de guardar: su resumen se ve, pero le faltan objetos.</Notice>}
          <VistaResumenAuditoria resumen={actual.resumen} />
          {anterior && (
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 13, color: "var(--tc-blue-800)" }}>Frente a la anterior de la etapa ({fecha(anterior.creada)})</strong>
              <table style={{ borderCollapse: "collapse", marginTop: 4 }}>
                <thead>
                  <tr>
                    <th style={th}>Disciplina</th>
                    <th style={th}>Antes</th>
                    <th style={th}>Ahora</th>
                    <th style={th}>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {comparar(anterior.resumen, actual.resumen).map((f) => (
                    <tr key={f.nombre}>
                      <td style={{ ...td, fontWeight: f.nombre === "Total" ? 700 : 400 }}>{f.nombre}</td>
                      <td style={td}>{f.antes === null ? "—" : `${f.antes.toLocaleString("es")} %`}</td>
                      <td style={td}>{f.despues === null ? "—" : `${f.despues.toLocaleString("es")} %`}</td>
                      <td style={{ ...td, fontWeight: 600, color: f.cambio === null ? undefined : f.cambio > 0 ? "#0a7a0a" : f.cambio < 0 ? "#b3261e" : undefined }}>
                        {f.cambio === null ? "—" : `${f.cambio > 0 ? "▲ +" : f.cambio < 0 ? "▼ −" : ""}${Math.abs(f.cambio).toLocaleString("es")} pts`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Excepciones({
  api,
  puede,
  excepciones,
  etapas,
  elems,
  parametros,
  onCambio,
}: {
  api: LoinApi;
  puede: boolean;
  excepciones: Excepcion[];
  etapas: Etapa[];
  elems: ElementosResponse;
  parametros: Parametro[];
  onCambio: (x: Excepcion) => void;
}) {
  const [filtro, setFiltro] = useState<"vigentes" | "revocadas" | "todas">("vigentes");
  const [etapaId, setEtapaId] = useState("");
  const [revocando, setRevocando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const parametro = new Map(parametros.map((p) => [p.id, p]));
  const elemento = new Map(elems.elementos.map((e) => [e.id, e]));
  const visibles = excepciones.filter((x) => (filtro === "todas" || (filtro === "vigentes") === x.activa) && (!etapaId || x.etapaId === etapaId));

  async function revocar(id: string) {
    setError("");
    try {
      onCambio(await api.revocarExcepcion(id, motivo));
      setRevocando(null);
      setMotivo("");
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <>
      <p style={{ ...ayuda, margin: 0 }}>
        Incumplimientos aceptados por el coordinador (en el visor 3D, pestaña Auditoría, al seleccionar un objeto). Cada uno vale para un objeto, un parámetro y una etapa. No se borran:
        se revocan y quedan en el historial con quién y por qué.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={select} aria-label="Estado de las excepciones">
          <option value="vigentes">Vigentes</option>
          <option value="revocadas">Revocadas</option>
          <option value="todas">Todas</option>
        </select>
        <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} style={select} aria-label="Etapa">
          <option value="">Todas las etapas</option>
          {etapas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ overflow: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Fecha</th>
              <th style={th}>Etapa</th>
              <th style={th}>Objeto (IFCGUID)</th>
              <th style={th}>Elemento</th>
              <th style={th}>Parámetro</th>
              <th style={th}>Justificación</th>
              <th style={th}>Autor</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td style={td} colSpan={8}>
                  No hay excepciones {filtro === "todas" ? "" : filtro}.
                </td>
              </tr>
            )}
            {visibles.map((x) => {
              const p = parametro.get(x.parametroId);
              const e = x.elementoId ? elemento.get(x.elementoId) : undefined;
              return (
                <tr key={x.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fecha(x.creada)}</td>
                  <td style={td}>{etapas.find((y) => y.id === x.etapaId)?.nombre ?? ""}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{x.ifcGuid}</td>
                  <td style={td}>{e ? `${e.codigo} · ${e.nombre}` : "—"}</td>
                  <td style={td}>{p ? `${p.codigo} · ${p.nombre}` : x.parametroId}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{x.justificacion}</td>
                  <td style={td}>{x.creadaPor ?? ""}</td>
                  <td style={{ ...td, minWidth: 170 }}>
                    {x.activa ? (
                      <>
                        <span style={etiqueta("#2e6b22", "#e4f3df")}>Vigente</span>
                        {puede && revocando !== x.id && (
                          <button type="button" style={{ ...linkBtn, marginLeft: 8 }} onClick={() => setRevocando(x.id)}>
                            Revocar
                          </button>
                        )}
                        {revocando === x.id && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                            <input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={500} placeholder="Por qué se revoca" style={{ ...campo, fontSize: 12.5 }} aria-label="Motivo de la revocación" />
                            <span style={{ display: "flex", gap: 6 }}>
                              <button type="button" style={{ ...acceptButton, padding: "3px 10px", fontSize: 12.5 }} disabled={motivo.trim().length < 3} onClick={() => revocar(x.id)}>
                                Revocar
                              </button>
                              <button type="button" style={linkBtn} onClick={() => setRevocando(null)}>
                                Cancelar
                              </button>
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 12.5 }}>
                        <span style={inactivo}>Revocada</span> {x.revocada ? fecha(x.revocada) : ""} {x.revocadaPor ? `por ${x.revocadaPor}` : ""}
                        {x.motivoRevocacion && <span style={{ display: "block", color: "var(--tc-gray-500)" }}>{x.motivoRevocacion}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const tarjeta: CSSProperties = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: 10 };

function subtab(activa: boolean): CSSProperties {
  return {
    border: "none",
    borderBottom: `3px solid ${activa ? C.header : "transparent"}`,
    background: "transparent",
    padding: "6px 12px",
    fontSize: 13.5,
    fontWeight: activa ? 600 : 400,
    color: activa ? C.header : "var(--tc-gray-700)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
