"use client";

import { useMemo, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { ESPERANDO, textoEstado } from "../../lib/flujo-aprobacion/registro";
import { puedeTrasladar, textoTraslado } from "../../lib/flujo-aprobacion/traslado";
import type { ArchivoInfo, EntradaHistorial, EstadoArchivo } from "../../lib/flujo-aprobacion/types";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { botonPeligro, card, etiqueta, linkBtn, select, td, texto, th, titulo } from "../compras/estilos";

export type ModoArchivos = "por-revisar" | "mios" | "todos";

const COLOR: Record<EstadoArchivo, [string, string]> = {
  pendiente: ["#8a5a00", "#fff4d6"],
  "nueva-version": ["#7a3e00", "#ffe6cc"],
  aprobado: ["#1e6b2c", "#e3f4e6"],
  rechazado: ["#a1261b", "#fdecea"],
  retirado: ["#5f6b7a", "#eceff3"],
};
const porRuta = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
const pequeno = { padding: "4px 12px", fontSize: 13.5 } as const;

type Datos = { yo: string; esAdmin: boolean; archivos: ArchivoInfo[] };

/** Whether the caller can approve or reject this file now (the server checks it again). */
const puedeDecidir = (a: ArchivoInfo, d: Datos) => ESPERANDO.includes(a.estado) && a.subidoPorId !== d.yo && (a.meToca || d.esAdmin);

/**
 * The registered files: what waits for the caller ("Por revisar", where they
 * approve or reject), what the caller uploaded ("Mis archivos"), or all of
 * them with filters. Each one opens in Trimble at the version under review and
 * shows its signatures and history.
 */
export default function Archivos({ api, modo, datos, error, onCambio }: { api: FlujoApi; modo: ModoArchivos; datos: Datos | null; error: string; onCambio: () => void }) {
  const [verTodos, setVerTodos] = useState(false);
  const [flujo, setFlujo] = useState("");
  const [estado, setEstado] = useState("");
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<{ id: string; que: "historial" | "decidir" } | null>(null);
  const [historial, setHistorial] = useState<{ id: string; entradas: EntradaHistorial[] | null; error: string } | null>(null);
  const [resultado, setResultado] = useState<{ kind: "info" | "error"; texto: string } | null>(null);

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = buscar.trim().toLowerCase();
    return datos.archivos
      .filter((a) => {
        if (modo === "por-revisar") return ESPERANDO.includes(a.estado) && (a.meToca || (datos.esAdmin && verTodos));
        if (modo === "mios") return a.subidoPorId === datos.yo;
        return true;
      })
      .filter((a) => (!flujo || a.flujoId === flujo) && (!estado || a.estado === estado) && (!q || a.ruta.toLowerCase().includes(q)))
      .sort((a, b) => porRuta.compare(a.hito, b.hito) || porRuta.compare(a.ruta, b.ruta));
  }, [datos, modo, verTodos, flujo, estado, buscar]);

  async function verHistorial(a: ArchivoInfo) {
    if (abierto?.id === a.id && abierto.que === "historial") {
      setAbierto(null);
      return;
    }
    setAbierto({ id: a.id, que: "historial" });
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
    "por-revisar": [
      "Por revisar",
      "Los archivos que esperan tu paso (por ti o por tu grupo: basta con una persona del grupo). Ábrelo en Trimble, revísalo y apruébalo o recházalo con el motivo. A quien subió una versión no le toca revisarla.",
    ],
    mios: ["Mis archivos", "Los archivos cuya última versión subiste tú, y en qué van. Si te rechazan uno, corrígelo y sube la versión nueva con el mismo nombre en la misma carpeta."],
    todos: ["Archivos", "Todos los archivos registrados en las carpetas de revisión, con su estado y sus firmas."],
  };

  return (
    <section style={{ ...card, maxWidth: 1200 }}>
      <h2 style={titulo}>{TITULOS[modo][0]}</h2>
      <p style={texto}>{TITULOS[modo][1]}</p>
      {error && <Notice kind="error">{error}</Notice>}
      {resultado && (
        <Notice kind={resultado.kind} style={{ marginBottom: 10 }}>
          {resultado.texto}
        </Notice>
      )}
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
      {datos && filas.length > 0 && (
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
                <FilaArchivo
                  key={a.id}
                  api={api}
                  a={a}
                  puede={puedeDecidir(a, datos)}
                  abierto={abierto?.id === a.id ? abierto.que : null}
                  historial={historial?.id === a.id ? historial : null}
                  onHistorial={() => verHistorial(a)}
                  onDecidir={() => setAbierto(abierto?.id === a.id && abierto.que === "decidir" ? null : { id: a.id, que: "decidir" })}
                  onDecidido={(r) => {
                    setResultado({ kind: "info", texto: [r.mensaje, r.aviso].filter(Boolean).join(" ") });
                    setAbierto(null);
                    onCambio();
                  }}
                  trasladable={puedeTrasladar(a, { id: datos.yo, esAdmin: datos.esAdmin }) === null}
                  onTraslado={(texto, error) => {
                    setResultado({ kind: error ? "error" : "info", texto });
                    onCambio();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {datos && filas.length > 0 && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "6px 0 0" }}>{filas.length === 1 ? "1 archivo" : `${filas.length} archivos`}</p>}
    </section>
  );
}

function FilaArchivo({
  api,
  a,
  puede,
  abierto,
  historial,
  onHistorial,
  onDecidir,
  onDecidido,
  trasladable,
  onTraslado,
}: {
  api: FlujoApi;
  a: ArchivoInfo;
  puede: boolean;
  abierto: "historial" | "decidir" | null;
  historial: { entradas: EntradaHistorial[] | null; error: string } | null;
  onHistorial: () => void;
  onDecidir: () => void;
  onDecidido: (r: { mensaje: string; aviso: string | null }) => void;
  trasladable: boolean;
  onTraslado: (texto: string, error: boolean) => void;
}) {
  const [color, fondo] = COLOR[a.estado];
  const carpeta = a.ruta.slice(0, Math.max(0, a.ruta.length - a.nombre.length - 3));
  const rechazo = a.estado === "rechazado" ? [...a.firmas].reverse().find((f) => f.decision === "rechazado") : undefined;
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
          {a.firmas.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: f.decision === "aprobado" ? "#1e6b2c" : "#a1261b" }} title={f.comentario || undefined}>
              {f.decision === "aprobado" ? "✓" : "✗"} {f.paso}: {f.quien}
              {f.comoAdmin ? " (admin.)" : ""}, {fechaHora(f.fecha).slice(0, 10)}
            </div>
          ))}
          {a.traslado && <EstadoTraslado api={api} a={a} trasladable={trasladable} onTraslado={onTraslado} />}
        </td>
        <td style={td}>
          {a.pasoNombre ? (
            <>
              <strong>{a.pasoNombre}</strong>
              {a.pasos.length > 1 && (
                <span style={{ color: "var(--tc-gray-500)" }}>
                  {" "}
                  (paso {a.pasoActual + 2} de {a.pasos.length + 1})
                </span>
              )}
              <div style={{ fontSize: 12.5, color: "var(--tc-gray-700)" }}>{a.responsables.length ? a.responsables.join(", ") : "Sin asignar: solo administradores"}</div>
            </>
          ) : rechazo ? (
            <>
              <strong>Corregir y subir una versión nueva</strong>
              <div style={{ fontSize: 12.5, color: "#a1261b" }}>Motivo: {rechazo.comentario}</div>
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
          {puede && (
            <button type="button" style={{ ...acceptButton, ...pequeno, marginRight: 8 }} onClick={onDecidir}>
              {abierto === "decidir" ? "Cerrar" : "Decidir"}
            </button>
          )}
          <button type="button" style={linkBtn} onClick={onHistorial}>
            {abierto === "historial" ? "Cerrar" : "Historial"}
          </button>
        </td>
      </tr>
      {abierto === "decidir" && (
        <tr>
          <td style={{ ...td, background: "#f6f8fb" }} colSpan={6}>
            <Decision api={api} a={a} onDecidido={onDecidido} />
          </td>
        </tr>
      )}
      {abierto === "historial" && (
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

const COLOR_TRASLADO: Record<NonNullable<ArchivoInfo["traslado"]>["estado"], string> = {
  hecho: "#1e6b2c",
  "en-curso": "#8a5a00",
  pendiente: "#8a5a00",
  diferencia: "#a1261b",
  error: "#a1261b",
};

/**
 * Where the approved version stands in the destination folder, and what the
 * approver or an administrator can do: copy again after an error, or replace a
 * file with that name that didn't come from the flow (after seeing it).
 */
function EstadoTraslado({ api, a, trasladable, onTraslado }: { api: FlujoApi; a: ArchivoInfo; trasladable: boolean; onTraslado: (texto: string, error: boolean) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const t = a.traslado!;
  async function pedir(paso: "trasladar" | "reemplazar") {
    setOcupado(true);
    try {
      const r = await api.traslado(paso, a.id, paso === "reemplazar" ? t.diferenciaVersionId : null);
      onTraslado(r.mensaje, r.traslado?.estado === "error");
    } catch (err) {
      onTraslado(message(err), true);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div style={{ marginTop: 4, fontSize: 12, color: COLOR_TRASLADO[t.estado] }} title={t.mensaje || undefined}>
      {t.estado === "hecho" ? "➜ " : t.estado === "en-curso" ? "⏳ " : "⚠ "}
      {textoTraslado(t, fechaHora)}
      {(t.estado === "error" || t.estado === "pendiente") && t.mensaje && <div style={{ color: "var(--tc-gray-700)" }}>{t.mensaje}</div>}
      {t.estado === "diferencia" && <div style={{ color: "var(--tc-gray-700)" }}>{t.diferenciaTexto}</div>}
      {trasladable && (t.estado === "error" || t.estado === "pendiente") && (
        <button type="button" disabled={ocupado} onClick={() => pedir("trasladar")} style={{ ...linkBtn, fontSize: 12, display: "block", marginTop: 2 }}>
          {ocupado ? "Copiando…" : "Trasladar otra vez"}
        </button>
      )}
      {trasladable && t.estado === "diferencia" && (
        <button type="button" disabled={ocupado} onClick={() => pedir("reemplazar")} style={{ ...linkBtn, fontSize: 12, display: "block", marginTop: 2 }} title="La versión aprobada queda encima como versión nueva; la otra sigue en el historial de versiones de Trimble">
          {ocupado ? "Copiando…" : "Reemplazar en el destino (queda como versión nueva)"}
        </button>
      )}
    </div>
  );
}

/** Approve (optional comment) or reject (reason required) the step the file waits for, on the version shown. */
function Decision({ api, a, onDecidido }: { api: FlujoApi; a: ArchivoInfo; onDecidido: (r: { mensaje: string; aviso: string | null }) => void }) {
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState<"aprobar" | "rechazar" | null>(null);
  const [error, setError] = useState("");
  const ultimo = a.pasoActual === a.pasos.length - 1;

  async function decidir(decision: "aprobar" | "rechazar") {
    if (decision === "rechazar" && comentario.trim().length < 3) {
      setError("Escribe el motivo del rechazo: el modelador lo necesita para corregir.");
      return;
    }
    setOcupado(decision);
    setError("");
    try {
      onDecidido(await api.decidir(decision, a.id, a.versionId, comentario));
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
      <div style={{ fontSize: 13.5 }}>
        Decides sobre la <strong>versión {a.revision ?? "?"}</strong> de «{a.nombre}» en el paso <strong>«{a.pasoNombre}»</strong>.{" "}
        <a href={a.enlace} target="_blank" rel="noopener noreferrer" style={linkBtn}>
          Ábrela en Trimble
        </a>{" "}
        antes de decidir.
        {ultimo ? " Es el último paso: al aprobar, el archivo queda aprobado y se copia a la carpeta destino." : ` Al aprobar pasa a «${a.pasos[a.pasoActual + 1]?.nombre}».`}
      </div>
      <label>
        <span style={labelStyle}>Comentario (opcional al aprobar) o motivo del rechazo (obligatorio)</span>
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={1000} rows={3} style={{ ...baseInput, width: "100%", fontSize: 14, resize: "vertical" }} placeholder="Por ejemplo: faltan los ejes en la planta del piso 3" />
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={!!ocupado} onClick={() => decidir("aprobar")} style={{ ...acceptButton, ...pequeno }}>
          {ocupado === "aprobar" ? "Aprobando…" : `Aprobar «${a.pasoNombre}»`}
        </button>
        <button type="button" disabled={!!ocupado} onClick={() => decidir("rechazar")} style={{ ...botonPeligro, ...pequeno }}>
          {ocupado === "rechazar" ? "Rechazando…" : "Rechazar"}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", alignSelf: "center" }}>
          Se avisa por tarea de Trimble a {ultimo ? "quien subió el archivo si lo rechazas" : "quien siga, o a quien subió el archivo si lo rechazas"}.
        </span>
      </div>
    </div>
  );
}
