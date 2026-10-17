"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { ESTADOS_REQUISICION, numeroRequisicion } from "../../lib/compras/requisiciones";
import { EstadoRequisicion, InsumosResponse, Permiso, PRIORIDADES, Prioridad, Requisicion, RequisicionesResponse } from "../../lib/compras/types";
import { fmt } from "../../lib/presupuesto/format";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import { botonSecundario, etiqueta, linkBtn, select, td, th } from "./estilos";
import RequisicionDialog from "./RequisicionDialog";

export const COLOR_PRIORIDAD: Record<Prioridad, { color: string; fondo: string }> = {
  baja: { color: "#6b7684", fondo: "#eef1f4" },
  normal: { color: "#0b5fa5", fondo: "#eaf4fc" },
  alta: { color: "#a35200", fondo: "#fdebd8" },
  urgente: { color: "#b3261e", fondo: "#fbe4e2" },
};

/** Valor estimado: approved quantities once approved, else what is asked, at the budget's prices. */
export function valorRequisicion(r: Requisicion): number {
  return r.lineas.reduce((s, l) => s + (r.estado === "aprobada" ? l.cantidadAprobada ?? 0 : l.cantidad) * l.precio, 0);
}

/** The project's requisitions: list, filters and the tolerance; each one opens in its dialog. */
export default function Requisiciones({ api, yo, permisos, onSinAcceso }: { api: ComprasApi; yo: string; permisos: Permiso[]; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<RequisicionesResponse | null>(null);
  const [insumos, setInsumos] = useState<InsumosResponse | null>(null);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState<EstadoRequisicion | "">("");
  const [mias, setMias] = useState(false);
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const [tolerancia, setTolerancia] = useState(false);
  const verInsumos = permisos.includes("insumos.ver");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [d, i] = await Promise.all([api.getRequisiciones(), verInsumos ? api.getInsumos() : Promise.resolve(null)]);
      setDatos(d);
      setInsumos(i);
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, verInsumos, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** After a save: the list, and the resources' totals (what was asked changed). */
  const actualizar = useCallback(
    (d: RequisicionesResponse) => {
      setDatos(d);
      if (verInsumos) api.getInsumos().then(setInsumos, () => undefined);
    },
    [api, verInsumos]
  );

  const filas = useMemo(
    () => (datos?.requisiciones ?? []).filter((r) => (!estado || r.estado === estado) && (!mias || r.solicitanteId === yo)),
    [datos, estado, mias, yo]
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando requisiciones…</p>;

  const porAprobar = datos.requisiciones.filter((r) => r.estado === "enviada").length;
  const requisicion = abierta && abierta !== "nueva" ? datos.requisiciones.find((r) => r.id === abierta) ?? null : null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {tiene(permisos, "requisiciones", "crear") && (
          <button type="button" onClick={() => setAbierta("nueva")} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }} disabled={!insumos}>
            ＋ Nueva requisición
          </button>
        )}
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoRequisicion | "")} style={select} aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADOS_REQUISICION) as EstadoRequisicion[]).map((e) => (
            <option key={e} value={e}>
              {ESTADOS_REQUISICION[e].texto}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={mias} onChange={(e) => setMias(e.target.checked)} aria-label="Solo las mías" />
          Solo las mías
        </label>
        {porAprobar > 0 && (
          <button type="button" onClick={() => setEstado("enviada")} style={{ ...linkBtn, fontSize: 13 }}>
            {porAprobar} por aprobar
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }} title="Cuánto se puede pedir sobre lo planificado sin justificar el exceso">
          Tolerancia sobre lo planificado: <strong>{fmt(datos.config.toleranciaPct)} %</strong> · mínimo de cotizaciones: <strong>{datos.config.minCotizaciones}</strong>
        </span>
        {tiene(permisos, "accesos", "administrar") && (
          <button type="button" onClick={() => setTolerancia(true)} style={{ ...linkBtn, fontSize: 13 }}>
            Cambiar
          </button>
        )}
      </div>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 200px)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>N.º</th>
              <th style={th}>Creada</th>
              <th style={th}>Solicitante</th>
              <th style={th}>Requerida</th>
              <th style={th}>Prioridad</th>
              <th style={th}>Estado</th>
              <th style={{ ...th, textAlign: "right" }}>Insumos</th>
              <th style={{ ...th, textAlign: "right" }} title="A precios del presupuesto">
                Valor estimado
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => {
              const e = ESTADOS_REQUISICION[r.estado];
              const p = COLOR_PRIORIDAD[r.prioridad];
              return (
                <tr key={r.id} onClick={() => setAbierta(r.id)} style={{ cursor: "pointer" }} title="Abrir">
                  <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => setAbierta(r.id)} style={linkBtn}>
                      {numeroRequisicion(r.numero)}
                    </button>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fechaHora(r.creada)}</td>
                  <td style={td}>{r.solicitanteNombre}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: r.fechaRequerida < datos.hoy && (r.estado === "borrador" || r.estado === "enviada") ? "#b3261e" : undefined }}>
                    {fecha(r.fechaRequerida)}
                  </td>
                  <td style={td}>
                    <span style={etiqueta(p.color, p.fondo)}>{PRIORIDADES.find((x) => x.id === r.prioridad)?.nombre}</span>
                  </td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{r.lineas.length}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(valorRequisicion(r))}</td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={8}>
                  {datos.requisiciones.length ? "Ninguna requisición coincide con los filtros." : "Todavía no hay requisiciones en este proyecto."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {abierta && (abierta === "nueva" || requisicion) && (
        <RequisicionDialog
          key={`${abierta}:${requisicion?.version ?? 0}`}
          api={api}
          datos={datos}
          insumos={insumos}
          requisicion={requisicion}
          yo={yo}
          permisos={permisos}
          onDatos={actualizar}
          onAbrir={setAbierta}
          onRecargar={cargar}
          onSinAcceso={onSinAcceso}
          onClose={() => setAbierta(null)}
        />
      )}
      {tolerancia && (
        <ToleranciaDialog
          api={api}
          actual={datos.config}
          onGuardado={(config) => {
            setDatos({ ...datos, config });
            setTolerancia(false);
          }}
          onClose={() => setTolerancia(false)}
        />
      )}
    </div>
  );
}

function ToleranciaDialog({
  api,
  actual,
  onGuardado,
  onClose,
}: {
  api: ComprasApi;
  actual: RequisicionesResponse["config"];
  onGuardado: (c: RequisicionesResponse["config"]) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState(String(actual.toleranciaPct));
  const [minimo, setMinimo] = useState(String(actual.minCotizaciones));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valor = Number(texto.replace(",", "."));
  const min = Number(minimo);
  const valido = texto.trim() !== "" && Number.isFinite(valor) && valor >= 0 && valor <= 100 && Number.isInteger(min) && min >= 1 && min <= 10;
  async function guardar() {
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.guardarConfig({ toleranciaPct: valor, minCotizaciones: min, version: actual.version }));
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }
  return (
    <Modal
      title="Configuración de compras"
      width={480}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !valido} style={{ ...acceptButton, opacity: valido ? 1 : 0.5 }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 14, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>
          Cuánto se puede pedir de cada insumo por encima de lo planificado sin escribir la justificación del exceso. Pasar ese límite requiere
          justificarlo, y aprobarlo, el permiso “Aprobar sobre el presupuesto”.
        </p>
        <label style={labelStyle} htmlFor="tolerancia">
          Tolerancia (%)
        </label>
        <input id="tolerancia" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ ...baseInput, width: 120 }} />
        <p style={{ margin: "8px 0 0" }}>Cuántas cotizaciones se esperan por requisición. Con menos, quien propone el proveedor debe justificar la elección.</p>
        <label style={labelStyle} htmlFor="min-cotizaciones">
          Mínimo de cotizaciones
        </label>
        <input id="min-cotizaciones" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)} style={{ ...baseInput, width: 120 }} />
        {!valido && <span style={{ fontSize: 13, color: "#b3261e" }}>La tolerancia va de 0 a 100 y el mínimo de cotizaciones de 1 a 10.</span>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
