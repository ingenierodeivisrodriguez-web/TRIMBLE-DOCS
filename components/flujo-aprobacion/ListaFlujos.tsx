"use client";

import type { CSSProperties } from "react";
import { codigoFlujo, describirCierre, diaVisible } from "../../lib/flujo-aprobacion/flujos";
import type { EstadoDocumento, FilaFlujo, FiltroLista, Tarjeta } from "../../lib/flujo-aprobacion/lista";
import type { Flujo } from "../../lib/flujo-aprobacion/types";
import { C } from "../presupuesto/ui";
import MenuPuntos from "./MenuPuntos";

const GRIS = { color: "#4b5563", fondo: "#e5e7eb", icono: "#4b5563" };

/** Where the flow's documents stand: only approved is green and rejected red; the rest is gray. */
export const ESTADO_DOCUMENTO: Record<EstadoDocumento, { texto: string; color: string; fondo: string; icono: string; signo: string }> = {
  "por-revisar": { texto: "Por revisar", ...GRIS, signo: "…" },
  "por-aprobar": { texto: "Por aprobar", ...GRIS, signo: "…" },
  aprobado: { texto: "Aprobado", color: "#fff", fondo: "#6b9e3f", icono: "#6b9e3f", signo: "✓" },
  rechazado: { texto: "Rechazado", color: "#fff", fondo: "#c0392b", icono: "#c0392b", signo: "✕" },
  "sin-archivos": { texto: "Sin archivos", ...GRIS, signo: "–" },
};

/** "Hover" text of the state: the count in words and, for a closed flow, since when. */
export function ayudaEstado(fila: Pick<FilaFlujo, "detalleEstado" | "cierre">): string {
  return `${fila.detalleEstado}.${fila.cierre ? ` Flujo cerrado desde la primera decisión (${describirCierre(fila.cierre)}): no se puede editar, activar ni desactivar.` : ""}`;
}

export function EtiquetaEstado({ estado, ayuda, desactivado }: { estado: EstadoDocumento; ayuda?: string; desactivado?: boolean }) {
  const e = ESTADO_DOCUMENTO[estado];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} title={ayuda}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: e.fondo, color: e.color, borderRadius: 3, padding: "3px 10px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "rgba(255,255,255,.85)", color: e.icono, fontSize: 10, fontWeight: 700 }}>{e.signo}</span>
        {e.texto}
      </span>
      {desactivado && <span style={{ border: "1px solid #d1d5db", color: "#6b7280", borderRadius: 3, padding: "1px 6px", fontSize: 11.5, whiteSpace: "nowrap" }}>Desactivado</span>}
    </span>
  );
}

const filtroSelect: CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--tc-gray-700)",
  fontFamily: "inherit",
  cursor: "pointer",
  padding: "4px 2px",
  maxWidth: 200,
};
/** The empty list after a dashboard card: nothing of the caller's in that state. */
const VACIO_TARJETA: Record<Tarjeta, string> = {
  "por-revisar": "No tienes archivos esperando tu revisión: aquí salen los flujos donde eres responsable del paso que espera.",
  "por-aprobar": "No tienes archivos esperando tu aprobación: aquí salen los flujos donde eres responsable del último paso y ya les toca.",
  aprobado: "No hay flujos aprobados donde hayas sido responsable o hayas decidido.",
};

const th: CSSProperties = { textAlign: "left", padding: "12px 10px", fontWeight: 400, fontSize: 14, color: "var(--tc-gray-700)", borderBottom: `1px solid ${C.border}`, background: "#fafbfc", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "12px 10px", fontSize: 14, borderBottom: `1px solid ${C.grid}`, verticalAlign: "middle" };

/**
 * The flows as one table, like Trimble's own lists: milestone, files, what
 * waits for the caller, due date, who reviews and approves, state. A click on
 * a row opens its details on the right; "⋮" has its actions.
 */
export default function ListaFlujos({
  filas,
  total,
  filtro,
  onFiltro,
  opciones,
  seleccionado,
  onSeleccionar,
  puedeEditar,
  onEditar,
  onActivar,
  onDesactivar,
  onReactivar,
  onPdf,
}: {
  filas: FilaFlujo[];
  /** Flows before filtering. */
  total: number;
  filtro: FiltroLista;
  onFiltro: (f: FiltroLista) => void;
  opciones: { propietarios: string[]; personas: { id: string; nombre: string }[] };
  seleccionado: string | null;
  onSeleccionar: (id: string) => void;
  /** Whoever created the flow, or a project administrator. */
  puedeEditar: (f: Flujo) => boolean;
  onEditar: (f: Flujo) => void;
  onActivar: (f: Flujo) => void;
  onDesactivar: (f: Flujo) => void;
  /** Opens its details asking to confirm "Reactivar el flujo". */
  onReactivar: (f: Flujo) => void;
  onPdf: (f: Flujo) => void;
}) {
  const cambiar = (c: Partial<FiltroLista>) => onFiltro({ ...filtro, ...c });
  const hayFiltro = !!(filtro.propietario || filtro.quien || filtro.estado || filtro.vence || filtro.porRevisar || filtro.texto || filtro.tarjeta);
  return (
    <div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "4px 0 12px" }}>
        <select value={filtro.propietario ?? ""} onChange={(e) => cambiar({ propietario: e.target.value })} style={filtroSelect} aria-label="Propietario">
          <option value="">Propietario</option>
          {opciones.propietarios.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={filtro.quien?.startsWith("persona:") ? filtro.quien : ""} onChange={(e) => cambiar({ quien: e.target.value })} style={filtroSelect} aria-label="Usuarios">
          <option value="">Usuarios</option>
          {opciones.personas.map((p) => (
            <option key={p.id} value={`persona:${p.id}`}>
              {p.nombre}
            </option>
          ))}
        </select>
        <select value={filtro.estado ?? ""} onChange={(e) => cambiar({ estado: e.target.value as FiltroLista["estado"] })} style={filtroSelect} aria-label="Estado">
          <option value="">Estado</option>
          <option value="por-revisar">Por revisar</option>
          <option value="por-aprobar">Por aprobar</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
          <option value="desactivado">Desactivado</option>
        </select>
        <select value={filtro.vence ?? ""} onChange={(e) => cambiar({ vence: e.target.value as FiltroLista["vence"] })} style={filtroSelect} aria-label="Fecha de vencimiento">
          <option value="">Fecha de vencimiento</option>
          <option value="vencidos">Vencidos</option>
          <option value="7dias">Vencen en los próximos 7 días</option>
          <option value="sin-fecha">Sin fecha</option>
        </select>
        <label style={{ fontSize: 14, cursor: "pointer", color: "var(--tc-gray-700)" }}>
          <input type="checkbox" checked={!!filtro.porRevisar} onChange={(e) => cambiar({ porRevisar: e.target.checked })} /> Tengo por revisar
        </label>
        {hayFiltro && (
          <button type="button" onClick={() => onFiltro({})} style={{ border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", fontSize: 13.5, fontFamily: "inherit" }}>
            Quitar filtros
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Nombre</th>
              <th style={{ ...th, textAlign: "center" }}>Archivos</th>
              <th style={{ ...th, textAlign: "center" }}>Por revisar</th>
              <th style={th}>Fecha de vencimiento</th>
              <th style={th}>Responsables</th>
              <th style={th}>Estado</th>
              <th style={{ ...th, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={7}>
                  {total === 0
                    ? "Todavía no hay flujos en este proyecto. Crea el primero con «Nuevo»."
                    : filtro.tarjeta
                      ? VACIO_TARJETA[filtro.tarjeta]
                      : "Ningún flujo cumple estos filtros."}
                </td>
              </tr>
            )}
            {filas.map((f) => {
              const activa = seleccionado === f.flujo.id;
              const vence = f.flujo.vence;
              // Closed by its first decision: nobody edits, activates or deactivates it.
              const editable = puedeEditar(f.flujo) && !f.cierre;
              return (
                <tr
                  key={f.flujo.id}
                  onClick={() => onSeleccionar(f.flujo.id)}
                  style={{ cursor: "pointer", background: activa ? "#e8f0fb" : undefined }}
                  onMouseEnter={(e) => !activa && (e.currentTarget.style.background = "#f6f8fb")}
                  onMouseLeave={(e) => !activa && (e.currentTarget.style.background = "")}
                >
                  <td style={td}>
                    {f.flujo.codigo ? <span style={{ display: "block", fontSize: 11.5, color: "var(--tc-gray-500)", letterSpacing: 0.3 }}>{codigoFlujo(f.flujo.codigo)}</span> : null}
                    <span style={{ color: "var(--tc-blue-700)", fontWeight: activa ? 600 : 500 }}>{f.flujo.hito}</span>
                  </td>
                  <td style={{ ...td, textAlign: "center", color: "var(--tc-blue-700)" }}>{f.archivos}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {f.porRevisar ? (
                      <span style={{ background: "#fff1d6", color: "#8a5a00", borderRadius: 10, padding: "1px 9px", fontWeight: 700, fontSize: 13 }} title="Archivos que esperan tu paso">
                        {f.porRevisar}
                      </span>
                    ) : (
                      <span style={{ color: "var(--tc-gray-500)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: f.vencido ? "#c0392b" : "var(--tc-blue-700)", fontWeight: f.vencido ? 600 : 400 }} title={f.vencido ? "Vencido: pasó la fecha y hay archivos esperando decisión" : undefined}>{vence ? diaVisible(vence) : <span style={{ color: "var(--tc-gray-500)" }}>—</span>}</td>
                  <td style={{ ...td, color: "var(--tc-blue-700)" }} title={f.responsables.join(", ")}>
                    {f.responsables.length ? `${f.responsables.slice(0, 2).join(", ")}${f.responsables.length > 2 ? ` y ${f.responsables.length - 2} más` : ""}` : <span style={{ color: "var(--tc-gray-500)" }}>Sin asignar</span>}
                  </td>
                  <td style={td}>
                    <EtiquetaEstado estado={f.estado} ayuda={ayudaEstado(f)} desactivado={!f.flujo.activo} />
                    {f.conVersionNueva > 0 && (
                      <div style={{ fontSize: 12, color: "#8a5a00", marginTop: 3 }} title="En Trimble hay versiones más nuevas que las que revisa este flujo; el flujo sigue con las suyas">
                        Versión nueva en Trimble{f.conVersionNueva > 1 ? ` (${f.conVersionNueva})` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <MenuPuntos
                      opciones={[
                        { texto: "Ver detalles", onClick: () => onSeleccionar(f.flujo.id) },
                        { texto: "PDF de trazabilidad", onClick: () => onPdf(f.flujo) },
                        { texto: "Editar", onClick: () => onEditar(f.flujo), oculto: !editable },
                        { texto: "Activar", onClick: () => onActivar(f.flujo), oculto: !editable || f.flujo.activo },
                        { texto: "Desactivar…", onClick: () => onDesactivar(f.flujo), oculto: !editable || !f.flujo.activo, peligro: true },
                        { texto: "Reactivar el flujo…", onClick: () => onReactivar(f.flujo), oculto: !puedeEditar(f.flujo) || f.conVersionNueva === 0 },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filas.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "6px 0 0" }}>
          {filas.length === total ? `${total} ${total === 1 ? "flujo" : "flujos"}` : `${filas.length} de ${total} flujos`}
        </p>
      )}
    </div>
  );
}
