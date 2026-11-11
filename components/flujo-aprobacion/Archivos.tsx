"use client";

import { useMemo, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { nombreDeRuta } from "../../lib/flujo-aprobacion/flujos";
import { ESPERANDO, textoEstado } from "../../lib/flujo-aprobacion/registro";
import { puedeTrasladar, textoTraslado } from "../../lib/flujo-aprobacion/traslado";
import type { ArchivoInfo, EstadoArchivo } from "../../lib/flujo-aprobacion/types";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { botonPeligro, etiqueta, linkBtn, select, td, texto, th } from "../compras/estilos";
import Explorador from "../publicar/Explorador";

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

/** Whether the caller can approve or reject this file now: it is their turn, or they administer the project and didn't upload it (the server checks it again). */
/** «Decidir» only for the step's responsible (11-11-2026); an administrator only on a step without responsible. */
const puedeDecidir = (a: ArchivoInfo, d: Datos) => ESPERANDO.includes(a.estado) && (a.meToca || (d.esAdmin && !a.responsables.length && a.subidoPorId !== d.yo));

/** An approved version of a flow without destination that isn't in a folder yet (or whose copy failed): it can be put in one. */
const sinCarpeta = (a: ArchivoInfo) =>
  !a.destino && !!a.versionAprobadaId && a.estado !== "retirado" && !(a.traslado && a.traslado.versionId === a.versionAprobadaId && (a.traslado.estado === "hecho" || a.traslado.estado === "en-curso"));

/**
 * The registered files: what waits for the caller ("Por revisar", where they
 * approve or reject), what the caller uploaded ("Mis archivos"), or all of
 * them with filters. Each one opens in Trimble at the version under review and
 * shows its signatures and history.
 */
export type VistaArchivos = "me-toca" | "todos" | "mios";

/**
 * The files of one flow, inside its side panel: what waits for the caller
 * («Me toca»: decide there), all of them, or what the caller uploaded. Each
 * one opens in Trimble at the version under review and shows its signatures,
 * where its copy to the destination stands, and its history.
 */
export default function Archivos({ api, projectId, flujoId, datos, error, onCambio }: { api: FlujoApi; projectId: string; flujoId: string; datos: Datos | null; error: string; onCambio: () => void }) {
  const delFlujo = useMemo(() => (datos?.archivos ?? []).filter((a) => a.flujoId === flujoId), [datos, flujoId]);
  const meTocan = delFlujo.filter((a) => ESPERANDO.includes(a.estado) && a.meToca).length;
  const mios = delFlujo.filter((a) => a.subidoPorId === datos?.yo).length;
  const [vista, setVista] = useState<VistaArchivos>(meTocan ? "me-toca" : "todos");
  const [estado, setEstado] = useState("");
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<{ id: string; que: "decidir" | "carpeta" } | null>(null);
  const [resultado, setResultado] = useState<{ kind: "info" | "error"; texto: string } | null>(null);

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = buscar.trim().toLowerCase();
    return delFlujo
      .filter((a) => (vista === "me-toca" ? ESPERANDO.includes(a.estado) && a.meToca : vista === "mios" ? a.subidoPorId === datos.yo : true))
      .filter((a) => (!estado || a.estado === estado) && (!q || a.ruta.toLowerCase().includes(q)))
      .sort((a, b) => porRuta.compare(a.ruta, b.ruta));
  }, [datos, delFlujo, vista, estado, buscar]);

  // Columns shown only when some row needs them (a cleaner table, 11-11-2026).
  const trasladableDe = (a: ArchivoInfo) => !!datos && puedeTrasladar(a, { id: datos.yo, esAdmin: datos.esAdmin }) === null;
  const conEspera = filas.some((a) => !!a.pasoNombre || a.estado === "rechazado");
  const conAcciones = !!datos && filas.some((a) => puedeDecidir(a, datos) || (trasladableDe(a) && sinCarpeta(a)));
  const columnas = 2 + (conEspera ? 1 : 0) + (conAcciones ? 1 : 0);

  const chip = (v: VistaArchivos, texto: string, n: number) => (
    <button
      key={v}
      type="button"
      onClick={() => setVista(v)}
      style={{
        border: `1px solid ${vista === v ? "var(--tc-blue-600)" : C.border}`,
        background: vista === v ? "#e8f0fb" : "#fff",
        color: vista === v ? "var(--tc-blue-800)" : "var(--tc-gray-700)",
        borderRadius: 14,
        padding: "3px 11px",
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
        fontWeight: v === "me-toca" && n > 0 ? 600 : 400,
      }}
    >
      {texto} ({n})
    </button>
  );

  return (
    <div>
      {error && <Notice kind="error">{error}</Notice>}
      {resultado && (
        <Notice kind={resultado.kind} style={{ marginBottom: 8 }}>
          {resultado.texto}
        </Notice>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        {chip("me-toca", "Me toca", meTocan)}
        {chip("todos", "Todos", delFlujo.length)}
        {chip("mios", "Subidos por mí", mios)}
        <select value={estado} onChange={(e) => setEstado(e.target.value)} style={{ ...select, fontSize: 13 }} aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(COLOR) as EstadoArchivo[]).map((e) => (
            <option key={e} value={e}>
              {textoEstado({ estado: e, revisionAprobada: null })}
            </option>
          ))}
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar archivo" style={{ ...baseInput, width: 140, fontSize: 13 }} />
      </div>
      {!datos && !error && <p style={{ ...texto, margin: 0 }}>Cargando…</p>}
      {datos && filas.length === 0 && (
        <p style={{ ...texto, margin: 0, fontSize: 13.5 }}>
          {vista === "me-toca" ? "No tienes archivos esperando tu revisión en este flujo." : vista === "mios" ? "No hay archivos de este flujo cuya última versión hayas subido tú." : "No hay archivos registrados con estos filtros."}
        </p>
      )}
      {datos && filas.length > 0 && (
        <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Archivo</th>
                <th style={th}>Estado</th>
                {conEspera && <th style={th}>Espera</th>}
                {conAcciones && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <FilaArchivo
                  key={a.id}
                  api={api}
                  projectId={projectId}
                  a={a}
                  puede={puedeDecidir(a, datos)}
                  propia={a.subidoPorId === datos.yo}
                  abierto={abierto?.id === a.id ? abierto.que : null}
                  conEspera={conEspera}
                  conAcciones={conAcciones}
                  columnas={columnas}
                  onDecidir={() => setAbierto(abierto?.id === a.id && abierto.que === "decidir" ? null : { id: a.id, que: "decidir" })}
                  onCarpeta={() => setAbierto(abierto?.id === a.id && abierto.que === "carpeta" ? null : { id: a.id, que: "carpeta" })}
                  onDecidido={(r) => {
                    setResultado({ kind: "info", texto: [r.mensaje, r.aviso].filter(Boolean).join(" ") });
                    setAbierto(null);
                    onCambio();
                  }}
                  trasladable={trasladableDe(a)}
                  onTraslado={(texto, err) => {
                    setResultado({ kind: err ? "error" : "info", texto });
                    if (!err) setAbierto(null);
                    onCambio();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaArchivo({
  api,
  projectId,
  a,
  puede,
  propia,
  abierto,
  conEspera,
  conAcciones,
  columnas,
  onDecidir,
  onCarpeta,
  onDecidido,
  trasladable,
  onTraslado,
}: {
  api: FlujoApi;
  projectId: string;
  a: ArchivoInfo;
  puede: boolean;
  /** The caller uploaded the version under review. */
  propia: boolean;
  abierto: "decidir" | "carpeta" | null;
  conEspera: boolean;
  conAcciones: boolean;
  /** How many columns the table shows (for the rows that open below). */
  columnas: number;
  onDecidir: () => void;
  onCarpeta: () => void;
  onDecidido: (r: { mensaje: string; aviso: string | null }) => void;
  trasladable: boolean;
  onTraslado: (texto: string, error: boolean) => void;
}) {
  const [color, fondo] = COLOR[a.estado];
  // The folder: the path without its last part (the name there may be a newer version's).
  const carpeta = a.ruta.lastIndexOf(" / ") > 0 ? a.ruta.slice(0, a.ruta.lastIndexOf(" / ")) : "";
  const rechazo = a.estado === "rechazado" ? [...a.firmas].reverse().find((f) => f.decision === "rechazado") : undefined;
  // The details stay one hover away: folder and upload on the name; signatures and the copy on the state.
  const ayudaArchivo = [carpeta, `Subió ${a.subidoPor || "—"}${a.subido ? `, ${fechaHora(a.subido)}` : ""}`, "Clic: abrir en Trimble la versión en revisión"].filter(Boolean).join("\n");
  const firmas = a.firmas.map((f) => `${f.decision === "aprobado" ? "✓" : "✗"} ${f.paso}: ${f.quien}${f.comoAdmin ? " (admin.)" : ""}${f.propia ? " (su propia versión)" : ""}, ${fechaHora(f.fecha).slice(0, 10)}${f.comentario ? ` — ${f.comentario}` : ""}`);
  const ayudaEstado = [...firmas, a.traslado?.estado === "hecho" ? `➜ ${textoTraslado(a.traslado, fechaHora)}` : ""].filter(Boolean).join("\n");
  const trasladoVisible = !!a.traslado && a.traslado.estado !== "hecho";
  return (
    <>
      <tr style={{ background: a.estado === "nueva-version" ? "#fffaf2" : undefined }}>
        <td style={td}>
          <a href={a.enlace} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, fontWeight: 600 }} title={ayudaArchivo}>
            {a.nombre}
          </a>
        </td>
        <td style={td}>
          <span style={{ ...etiqueta(color, fondo), cursor: ayudaEstado ? "help" : undefined }} title={ayudaEstado || undefined}>
            {textoEstado(a)}
          </span>
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 2 }}>Versión {a.revision ?? "?"}</div>
          {a.versionNueva && a.estado !== "retirado" && <AvisoVersionNueva a={a} />}
          {/* A copy that needs attention stays visible (it has its buttons); a finished one is in the tooltip. */}
          {trasladoVisible && <EstadoTraslado api={api} a={a} trasladable={trasladable} onTraslado={onTraslado} />}
        </td>
        {conEspera && (
          <td style={td}>
            {a.pasoNombre ? (
              <span title={a.pasos.length > 1 ? `Paso ${a.pasoActual + 2} de ${a.pasos.length + 1}` : undefined}>
                <strong>{a.pasoNombre}</strong>
                <div style={{ fontSize: 12.5, color: "var(--tc-gray-700)" }}>{a.responsables.length ? a.responsables.join(", ") : "Sin asignar: solo administradores"}</div>
              </span>
            ) : rechazo ? (
              <span title="La versión corregida no entra sola a este flujo: aparece como aviso en el archivo.">
                <strong>Corregir</strong>
                <div style={{ fontSize: 12.5, color: "#a1261b" }}>Motivo: {rechazo.comentario}</div>
              </span>
            ) : null}
          </td>
        )}
        {conAcciones && (
          <td style={{ ...td, whiteSpace: "nowrap" }}>
            {puede && (
              <button type="button" style={{ ...acceptButton, ...pequeno, display: "block", marginBottom: 4 }} onClick={onDecidir}>
                {abierto === "decidir" ? "Cerrar" : "Decidir"}
              </button>
            )}
            {trasladable && sinCarpeta(a) && (
              <button type="button" style={{ ...linkBtn, display: "block", marginBottom: 4 }} onClick={onCarpeta} title="Copiar la versión aprobada a una carpeta donde tengas permiso">
                {abierto === "carpeta" ? "Cerrar" : a.traslado?.versionId === a.versionAprobadaId ? "Poner en otra carpeta…" : "Poner en una carpeta…"}
              </button>
            )}
          </td>
        )}
      </tr>
      {abierto === "decidir" && (
        <tr>
          <td style={{ ...td, background: "#f6f8fb" }} colSpan={columnas}>
            <Decision api={api} projectId={projectId} a={a} propia={propia} onDecidido={onDecidido} />
          </td>
        </tr>
      )}
      {abierto === "carpeta" && (
        <tr>
          <td style={{ ...td, background: "#f6f8fb" }} colSpan={columnas}>
            <PonerEnCarpeta api={api} projectId={projectId} a={a} onTraslado={onTraslado} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The notice of a newer version in Trimble (the flow keeps its own, 10-11-2026):
 * which one, who uploaded it and when, and a link to open it and compare.
 */
function AvisoVersionNueva({ a }: { a: ArchivoInfo }) {
  const v = a.versionNueva!;
  return (
    <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.4, color: "#7a4b00", background: "#fff7e6", border: "1px solid #f3d9a4", borderRadius: 4, padding: "4px 8px", maxWidth: 360 }}>
      <strong>Hay una versión más nueva en Trimble:</strong> versión {v.revision ?? "?"}
      {v.nombre && v.nombre !== a.nombre ? ` («${v.nombre}»)` : ""}, subida por {v.subidoPor || "—"}
      {v.subido ? ` el ${fechaHora(v.subido)}` : ""}. Este flujo revisa la versión {a.revision ?? "?"}.{" "}
      {a.enlaceNueva && (
        <a href={a.enlaceNueva} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, fontSize: 12 }} title="Abrir en Trimble la versión más nueva, para comparar">
          Ver la versión {v.revision ?? "nueva"}
        </a>
      )}
    </div>
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
 * Where the approved version stands in its folder, and what the approver or an
 * administrator can do: copy again after an error, or replace a file with that
 * name that didn't come from the flow (after seeing it).
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
          {ocupado ? "Copiando…" : "Copiar otra vez"}
        </button>
      )}
      {trasladable && t.estado === "diferencia" && (
        <button type="button" disabled={ocupado} onClick={() => pedir("reemplazar")} style={{ ...linkBtn, fontSize: 12, display: "block", marginTop: 2 }} title="La versión aprobada queda encima como versión nueva; la otra sigue en el historial de versiones de Trimble">
          {ocupado ? "Copiando…" : "Reemplazar ahí (queda como versión nueva)"}
        </button>
      )}
    </div>
  );
}

/** A folder of the project, chosen in the explorer (only where the caller isn't read-only). */
function ElegirCarpeta({ api, projectId, carpeta, onElegir }: { api: FlujoApi; projectId: string; carpeta: { id: string; ruta: string } | null; onElegir: (c: { id: string; ruta: string }) => void }) {
  return (
    <div>
      <Explorador api={api} proyecto={projectId} elegir="carpeta" seleccionados={carpeta ? [carpeta.id] : []} onElegir={(e) => onElegir({ id: e.id, ruta: e.ruta })} />
      <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
        Abre la carpeta y pulsa «Usar esta carpeta». Solo sirven carpetas donde Trimble te deja subir archivos, y no la carpeta donde está el archivo. Si ahí ya hay un archivo con ese nombre que llegó por el flujo, queda encima como versión nueva; si no llegó por el flujo, se pregunta antes de reemplazarlo.
      </p>
    </div>
  );
}

/** «Poner en una carpeta…»: the approved version (not yet in a folder, or whose copy failed) goes to the folder chosen. */
function PonerEnCarpeta({ api, projectId, a, onTraslado }: { api: FlujoApi; projectId: string; a: ArchivoInfo; onTraslado: (texto: string, error: boolean) => void }) {
  const [carpeta, setCarpeta] = useState<{ id: string; ruta: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  async function poner() {
    if (!carpeta) return;
    setOcupado(true);
    setError("");
    try {
      const r = await api.traslado("trasladar", a.id, null, carpeta.id);
      onTraslado(r.mensaje, r.traslado?.estado === "error");
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
      <div style={{ fontSize: 13.5 }}>
        ¿Dónde poner la <strong>versión {a.revisionAprobada ?? "?"} aprobada</strong> de «{a.nombre}»? Se copia con el mismo nombre; el archivo sigue también donde está.
      </div>
      <ElegirCarpeta api={api} projectId={projectId} carpeta={carpeta} onElegir={setCarpeta} />
      {error && <Notice kind="error">{error}</Notice>}
      <div>
        <button type="button" disabled={!carpeta || ocupado} onClick={() => void poner()} style={{ ...acceptButton, ...pequeno, opacity: carpeta ? 1 : 0.5 }}>
          {ocupado ? "Copiando…" : carpeta ? `Poner en «${nombreDeRuta(carpeta.ruta)}»` : "Elige la carpeta"}
        </button>
      </div>
    </div>
  );
}

/**
 * Approve (optional comment) or reject (reason required) the step the file
 * waits for, on the version shown. On the last step of a flow without
 * destination, the responsible also decides what to do with the approved
 * version: leave it where it is, or put it in a folder too (the one used
 * before is proposed).
 */
function Decision({ api, projectId, a, propia, onDecidido }: { api: FlujoApi; projectId: string; a: ArchivoInfo; propia: boolean; onDecidido: (r: { mensaje: string; aviso: string | null }) => void }) {
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState<"aprobar" | "rechazar" | null>(null);
  const [error, setError] = useState("");
  const ultimo = a.pasoActual === a.pasos.length - 1;
  const eligeCarpeta = ultimo && !a.destino;
  const anterior = a.traslado?.carpetaId ? { id: a.traslado.carpetaId, ruta: a.traslado.carpetaRuta } : null;
  const [modo, setModo] = useState<"dejar" | "carpeta">(anterior ? "carpeta" : "dejar");
  const [carpeta, setCarpeta] = useState<{ id: string; ruta: string } | null>(anterior);
  const [explorando, setExplorando] = useState(false);
  const conCarpeta = eligeCarpeta && modo === "carpeta";
  const faltaCarpeta = conCarpeta && !carpeta;

  async function decidir(decision: "aprobar" | "rechazar") {
    if (decision === "rechazar" && comentario.trim().length < 3) {
      setError("Escribe el motivo del rechazo: el modelador lo necesita para corregir.");
      return;
    }
    if (decision === "aprobar" && faltaCarpeta) {
      setError("Elige la carpeta donde poner la versión aprobada, o marca «Dejarla donde está».");
      return;
    }
    setOcupado(decision);
    setError("");
    try {
      onDecidido(await api.decidir(decision, a.id, a.versionId, comentario, decision === "aprobar" && conCarpeta ? carpeta?.id : null));
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
        {ultimo
          ? a.destino
            ? " Es el último paso: al aprobar, el archivo queda aprobado y se copia a la carpeta destino."
            : " Es el último paso: al aprobar, el archivo queda aprobado y tú decides si lo pones también en una carpeta."
          : ` Al aprobar pasa a «${a.pasos[a.pasoActual + 1]?.nombre}».`}
        {propia && " Tú subiste esta versión: como responsable del paso puedes decidirla, y la firma queda anotada como «su propia versión»."}
      </div>
      {a.versionNueva && (
        <div style={{ fontSize: 13 }}>
          <AvisoVersionNueva a={a} />
          <div style={{ marginTop: 4, color: "var(--tc-gray-700)" }}>
            Tu decisión es sobre la versión {a.revision ?? "?"}, la de este flujo; la versión {a.versionNueva.revision ?? "nueva"} no entra a este flujo. Si la que vale es la nueva, puedes rechazar esta diciendo el motivo.
          </div>
        </div>
      )}
      {eligeCarpeta && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px", background: "#fff", display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tc-gray-700)" }}>¿Qué hacer con la versión aprobada?</div>
          <label style={{ fontSize: 13.5, cursor: "pointer" }}>
            <input type="radio" name={`destino-${a.id}`} checked={modo === "dejar"} onChange={() => setModo("dejar")} /> Dejarla donde está
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
            <label style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name={`destino-${a.id}`}
                checked={modo === "carpeta"}
                onChange={() => {
                  setModo("carpeta");
                  if (!carpeta) setExplorando(true);
                }}
              />{" "}
              Ponerla también en una carpeta
            </label>
            {modo === "carpeta" && carpeta && <strong title={carpeta.ruta}>«{carpeta.ruta}»</strong>}
            {modo === "carpeta" && (
              <button type="button" style={linkBtn} onClick={() => setExplorando(!explorando)}>
                {explorando ? "Cerrar el explorador" : carpeta ? "Cambiar" : "Elegir la carpeta"}
              </button>
            )}
          </div>
          {modo === "carpeta" && anterior && carpeta?.id === anterior.id && <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Es la carpeta donde quedó la versión aprobada anterior: esta llega encima como versión nueva.</div>}
          {modo === "carpeta" && explorando && (
            <ElegirCarpeta
              api={api}
              projectId={projectId}
              carpeta={carpeta}
              onElegir={(c) => {
                setCarpeta(c);
                setExplorando(false);
              }}
            />
          )}
        </div>
      )}
      <label>
        <span style={labelStyle}>Comentario (opcional al aprobar) o motivo del rechazo (obligatorio)</span>
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={1000} rows={3} style={{ ...baseInput, width: "100%", fontSize: 14, resize: "vertical" }} placeholder="Por ejemplo: faltan los ejes en la planta del piso 3" />
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={!!ocupado} onClick={() => decidir("aprobar")} style={{ ...acceptButton, ...pequeno, opacity: faltaCarpeta ? 0.6 : 1 }} title={faltaCarpeta ? "Elige la carpeta primero" : undefined}>
          {ocupado === "aprobar" ? "Aprobando…" : conCarpeta && carpeta ? `Aprobar y poner en «${nombreDeRuta(carpeta.ruta)}»` : `Aprobar «${a.pasoNombre}»`}
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
