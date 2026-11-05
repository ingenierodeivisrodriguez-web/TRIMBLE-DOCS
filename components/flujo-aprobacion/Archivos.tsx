"use client";

import { useMemo, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { ESPERANDO, textoEstado } from "../../lib/flujo-aprobacion/registro";
import type { ArchivoInfo, EntradaHistorial, EstadoArchivo } from "../../lib/flujo-aprobacion/types";
import { baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { card, etiqueta, linkBtn, select, td, texto, th, titulo } from "../compras/estilos";

export type ModoArchivos = "por-revisar" | "mios" | "todos";

const COLOR: Record<EstadoArchivo, [string, string]> = {
  pendiente: ["#8a5a00", "#fff4d6"],
  "nueva-version": ["#7a3e00", "#ffe6cc"],
  aprobado: ["#1e6b2c", "#e3f4e6"],
  rechazado: ["#a1261b", "#fdecea"],
  retirado: ["#5f6b7a", "#eceff3"],
};
const porRuta = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * The registered files: what waits for the caller ("Por revisar"), what the
 * caller uploaded ("Mis archivos"), or all of them with filters. Each one
 * opens in Trimble at the version under review and shows its history.
 */
export default function Archivos({
  api,
  modo,
  datos,
  error,
}: {
  api: FlujoApi;
  modo: ModoArchivos;
  datos: { yo: string; esAdmin: boolean; archivos: ArchivoInfo[] } | null;
  error: string;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const [flujo, setFlujo] = useState("");
  const [estado, setEstado] = useState("");
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [historial, setHistorial] = useState<{ id: string; entradas: EntradaHistorial[] | null; error: string } | null>(null);

  const filas = useMemo(() => {
    if (!datos) return [];
    const texto = buscar.trim().toLowerCase();
    return datos.archivos
      .filter((a) => {
        if (modo === "por-revisar") return ESPERANDO.includes(a.estado) && (a.meToca || (datos.esAdmin && verTodos));
        if (modo === "mios") return a.subidoPorId === datos.yo;
        return true;
      })
      .filter((a) => (!flujo || a.flujoId === flujo) && (!estado || a.estado === estado) && (!texto || a.ruta.toLowerCase().includes(texto)))
      .sort((a, b) => porRuta.compare(a.hito, b.hito) || porRuta.compare(a.ruta, b.ruta));
  }, [datos, modo, verTodos, flujo, estado, buscar]);

  async function verHistorial(a: ArchivoInfo) {
    if (abierto === a.id) {
      setAbierto(null);
      return;
    }
    setAbierto(a.id);
    setHistorial({ id: a.id, entradas: null, error: "" });
    try {
      const r = await api.historial(undefined, a.id);
      setHistorial({ id: a.id, entradas: r.entradas, error: "" });
    } catch (err) {
      setHistorial({ id: a.id, entradas: null, error: message(err) });
    }
  }

  const flujos = useMemo(() => [...new Map((datos?.archivos ?? []).map((a) => [a.flujoId, a.hito])).entries()], [datos]);
  const TITULOS: Record<ModoArchivos, [string, string]> = {
    "por-revisar": ["Por revisar", "Los archivos que esperan tu paso (por ti o por tu grupo). A quien subió una versión no le toca revisarla. Aprobar y rechazar llegan en la fase 3."],
    mios: ["Mis archivos", "Los archivos cuya última versión subiste tú, y en qué van."],
    todos: ["Archivos", "Todos los archivos registrados en las carpetas de revisión, con su estado."],
  };

  return (
    <section style={{ ...card, maxWidth: 1200 }}>
      <h2 style={titulo}>{TITULOS[modo][0]}</h2>
      <p style={texto}>{TITULOS[modo][1]}</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 10 }}>
        {modo === "por-revisar" && datos?.esAdmin && (
          <label style={{ fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver todos los pendientes (administrador)
          </label>
        )}
        {modo === "todos" && (
          <>
            <label>
              <span style={labelStyle}>Flujo</span>
              <select value={flujo} onChange={(e) => setFlujo(e.target.value)} style={{ ...select, minWidth: 220 }}>
                <option value="">Todos</option>
                {flujos.map(([id, hito]) => (
                  <option key={id} value={id}>
                    {hito}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={labelStyle}>Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)} style={select}>
                <option value="">Todos</option>
                {(Object.keys(COLOR) as EstadoArchivo[]).map((e) => (
                  <option key={e} value={e}>
                    {textoEstado({ estado: e, revisionAprobada: null })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={labelStyle}>Buscar</span>
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o carpeta" style={{ ...baseInput, width: 220 }} />
            </label>
          </>
        )}
      </div>
      {!datos && !error && <p style={{ ...texto, margin: 0 }}>Cargando…</p>}
      {datos && filas.length === 0 && (
        <p style={{ ...texto, margin: 0 }}>
          {modo === "por-revisar" ? "No tienes archivos esperando tu revisión." : modo === "mios" ? "No hay archivos registrados cuya última versión hayas subido tú." : "No hay archivos registrados con estos filtros."}
        </p>
      )}
      {filas.length > 0 && (
        <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Archivo</th>
                <th style={th}>Flujo (hito)</th>
                <th style={th}>Estado</th>
                <th style={th}>Espera</th>
                <th style={th}>Subió</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <FilaArchivo key={a.id} a={a} abierto={abierto === a.id} historial={historial?.id === a.id ? historial : null} onHistorial={() => verHistorial(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && filas.length > 0 && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "6px 0 0" }}>{filas.length === 1 ? "1 archivo" : `${filas.length} archivos`}</p>}
    </section>
  );
}

function FilaArchivo({ a, abierto, historial, onHistorial }: { a: ArchivoInfo; abierto: boolean; historial: { entradas: EntradaHistorial[] | null; error: string } | null; onHistorial: () => void }) {
  const [color, fondo] = COLOR[a.estado];
  const carpeta = a.ruta.slice(0, Math.max(0, a.ruta.length - a.nombre.length - 3));
  return (
    <>
      <tr style={{ background: a.estado === "nueva-version" ? "#fffaf2" : undefined }}>
        <td style={td}>
          <a href={a.enlace} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, fontWeight: 600 }} title="Abrir en Trimble la versión en revisión">
            {a.nombre}
          </a>
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{carpeta}</div>
        </td>
        <td style={td}>{a.hito}</td>
        <td style={td}>
          <span style={etiqueta(color, fondo)}>{textoEstado(a)}</span>
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 2 }}>Versión {a.revision ?? "?"}</div>
        </td>
        <td style={td}>
          {a.pasoNombre ? (
            <>
              <strong>{a.pasoNombre}</strong>
              {a.pasos.length > 1 && <span style={{ color: "var(--tc-gray-500)" }}> (paso {a.pasoActual + 2} de {a.pasos.length + 1})</span>}
              <div style={{ fontSize: 12.5, color: "var(--tc-gray-700)" }}>{a.responsables.length ? a.responsables.join(", ") : "Sin asignar: solo administradores"}</div>
            </>
          ) : (
            "—"
          )}
        </td>
        <td style={td}>
          {a.subidoPor || "—"}
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{a.subido ? fechaHora(a.subido) : ""}</div>
        </td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>
          <button type="button" style={linkBtn} onClick={onHistorial}>
            {abierto ? "Cerrar" : "Historial"}
          </button>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td style={{ ...td, background: "#f6f8fb" }} colSpan={6}>
            {historial?.error && <Notice kind="error">{historial.error}</Notice>}
            {!historial?.entradas && !historial?.error && "Cargando…"}
            {historial?.entradas && historial.entradas.length === 0 && "Sin historial."}
            {historial?.entradas && historial.entradas.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 13 }}>
                {historial.entradas.map((e) => (
                  <li key={e.id}>
                    <strong>{fechaHora(e.ocurrido ?? e.creado)}</strong>
                    {e.usuario ? ` · ${e.usuario}` : ""} · {e.detalle}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
