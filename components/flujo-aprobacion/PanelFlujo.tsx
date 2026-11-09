"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { describirCierre, diaVisible, nombreResponsable, puedeCambiar } from "../../lib/flujo-aprobacion/flujos";
import type { FilaFlujo } from "../../lib/flujo-aprobacion/lista";
import type { ArchivoInfo, EstadoFlujos } from "../../lib/flujo-aprobacion/types";
import { botonPeligro, botonSecundario } from "../compras/estilos";
import { C, message, Notice } from "../presupuesto/ui";
import Archivos from "./Archivos";
import Comentarios from "./Comentarios";
import { descargarTrazabilidad } from "./descargas";
import Historial from "./Historial";
import { ayudaEstado, EtiquetaEstado } from "./ListaFlujos";
import MenuPuntos from "./MenuPuntos";
import Permisos from "./Permisos";

type Seccion = "detalles" | "archivos" | "permisos" | "historial" | "comentarios";

const icono = { border: "none", background: "transparent", borderRadius: 4, width: 32, height: 32, cursor: "pointer", fontSize: 17, color: "var(--tc-gray-700)" } as const;

function Bloque({ titulo, abierto, onAlternar, children, extra }: { titulo: string; abierto: boolean; onAlternar: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <section style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px" }}>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", border: "none", background: "transparent", padding: "2px 0", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--tc-gray-700)" }}>{titulo}</span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          {extra}
          <span aria-hidden>{abierto ? "▾" : "▸"}</span>
        </span>
      </button>
      {abierto && <div style={{ marginTop: 8 }}>{children}</div>}
    </section>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{etiqueta}</div>
      <div style={{ fontSize: 14, color: "var(--tc-gray-700)" }}>{children}</div>
    </div>
  );
}

/**
 * A flow's details on the right of the single screen, like Trimble's own side
 * panels: its state and data (steps and their responsibles), its files
 * (decide there), the Trimble permissions (for whoever can change it), its
 * history and its comments. "⬇" saves its traceability as PDF; the bin
 * deactivates it (it is never deleted).
 */
export default function PanelFlujo({
  api,
  projectId,
  projectName,
  fila,
  datos,
  archivos,
  errorArchivos,
  recarga,
  pedirDesactivar,
  onCambio,
  onCambioArchivos,
  onEditar,
  onCerrar,
}: {
  api: FlujoApi;
  projectId: string;
  projectName: string;
  fila: FilaFlujo;
  datos: EstadoFlujos;
  archivos: { yo: string; esAdmin: boolean; archivos: ArchivoInfo[] } | null;
  errorArchivos: string;
  recarga: number;
  /** The list's "Desactivar…" asked for the confirmation. */
  pedirDesactivar: boolean;
  onCambio: (e: EstadoFlujos) => void;
  onCambioArchivos: () => void;
  onEditar: () => void;
  onCerrar: () => void;
}) {
  const f = fila.flujo;
  const [abiertas, setAbiertas] = useState<Set<Seccion>>(new Set(["detalles", "archivos", "comentarios"]));
  const [desactivar, setDesactivar] = useState(pedirDesactivar);
  const [aviso, setAviso] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const [generando, setGenerando] = useState(false);
  const permisosRef = useRef<HTMLDivElement>(null);
  // Whoever created the flow, or a project administrator.
  const puede = puedeCambiar(f, { id: datos.yo, esAdmin: datos.esAdmin });
  // Closed by its first decision: nobody edits, activates or deactivates it (09-11-2026).
  const editable = puede && !fila.cierre;

  useEffect(() => setDesactivar(pedirDesactivar && !fila.cierre), [pedirDesactivar, f.id, fila.cierre]);
  useEffect(() => setAviso(null), [f.id]);

  const alternar = (s: Seccion) =>
    setAbiertas((x) => {
      const n = new Set(x);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  async function cambiarEstado(activo: boolean) {
    setAviso(null);
    try {
      onCambio(await api.cambiarEstado(f.id, f.version, activo));
      setDesactivar(false);
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    }
  }

  async function pdf() {
    setGenerando(true);
    try {
      await descargarTrazabilidad(api, { flujoId: f.id }, projectName, f.hito);
    } catch (err) {
      setAviso({ kind: "error", texto: `No se pudo generar el PDF: ${message(err)}` });
    } finally {
      setGenerando(false);
    }
  }

  const verPermisos = () => {
    setAbiertas((x) => new Set([...x, "permisos"]));
    setTimeout(() => permisosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div style={{ background: "#fff", minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 16px 8px" }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 500, color: "var(--tc-gray-700)", lineHeight: 1.3 }}>{f.hito}</h2>
        <button type="button" onClick={onCerrar} style={{ ...icono, fontSize: 20 }} title="Cerrar los detalles" aria-label="Cerrar los detalles">
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "0 10px 8px" }}>
        <button type="button" onClick={() => void pdf()} disabled={generando} style={icono} title="Descargar la trazabilidad de este flujo en PDF" aria-label="Descargar PDF">
          {generando ? (
            "…"
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12" stroke="#4b5563" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {editable && f.activo && (
          <button type="button" onClick={() => setDesactivar(true)} style={icono} title="Desactivar el flujo (no se borra)" aria-label="Desactivar">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 6h10l-.8 10.2a1 1 0 0 1-1 .8H6.8a1 1 0 0 1-1-.8zM3.5 6h13M8 6V4h4v2" stroke="#4b5563" strokeWidth="1.7" fill="#6b7280" fillOpacity=".25" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <MenuPuntos
          opciones={[
            { texto: "Editar", onClick: onEditar, oculto: !editable },
            { texto: "Revisar permisos de Trimble", onClick: verPermisos, oculto: !puede },
            { texto: "Activar", onClick: () => void cambiarEstado(true), oculto: !editable || f.activo },
            { texto: "Desactivar…", onClick: () => setDesactivar(true), oculto: !editable || !f.activo, peligro: true },
          ]}
        />
      </div>
      {desactivar && editable && (
        <Notice kind="warning" style={{ margin: "0 16px 10px" }}>
          Al desactivar «{f.hito}» deja de revisar versiones nuevas de sus archivos. No se borra: su configuración, sus archivos y su historial se conservan y se puede volver a activar.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" style={{ ...botonPeligro, padding: "5px 12px", fontSize: 13.5 }} onClick={() => void cambiarEstado(false)}>
              Desactivar
            </button>
            <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} onClick={() => setDesactivar(false)}>
              No
            </button>
          </div>
        </Notice>
      )}
      {aviso && (
        <Notice kind={aviso.kind} style={{ margin: "0 16px 10px" }}>
          {aviso.texto}
        </Notice>
      )}

      <Bloque titulo="Detalles" abierto={abiertas.has("detalles")} onAlternar={() => alternar("detalles")}>
        <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <EtiquetaEstado estado={fila.estado} ayuda={ayudaEstado(fila)} desactivado={!f.activo} />
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{fila.detalleEstado}</span>
        </div>
        {fila.cierre && (
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--tc-gray-700)", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "7px 10px" }}>
            <strong>Flujo cerrado</strong> desde la primera decisión ({describirCierre(fila.cierre)}): ya no se puede editar, activar ni desactivar. Sigue revisando las versiones nuevas de sus archivos.
          </p>
        )}
        <Dato etiqueta="Fecha de vencimiento">{f.vence ? <span style={{ color: fila.vencido ? "#c0392b" : undefined }}>{diaVisible(f.vence)}{fila.vencido ? " (vencido, con archivos esperando decisión)" : ""}</span> : "Sin fecha"}</Dato>
        <Dato etiqueta="Pasos y responsables">
          <div>
            <strong>Realiza:</strong> quien sube cada versión (y la corrige si la rechazan)
          </div>
          {f.pasos.map((p) => (
            <div key={p.id}>
              <strong>{p.nombre}:</strong> {p.responsable ? nombreResponsable(p.responsable) : <span style={{ color: "#a1261b" }}>sin responsable{editable ? " (edita el flujo para elegirlo)" : " (lo decide un administrador)"}</span>}
            </div>
          ))}
        </Dato>
        <Dato etiqueta="Archivos">
          {f.archivos.length} {f.archivos.length === 1 ? "elegido" : "elegidos"} · {fila.pendientes} esperando decisión{fila.porRevisar ? ` (${fila.porRevisar} te tocan)` : ""}
        </Dato>
        {f.destino && <Dato etiqueta="Carpeta destino (flujo anterior)">{f.destino.ruta}</Dato>}
        {f.notas && <Dato etiqueta="Notas"><span style={{ whiteSpace: "pre-wrap" }}>{f.notas}</span></Dato>}
        <Dato etiqueta="Creado/a">{`${fechaHora(f.creado).slice(0, 10)} por ${f.creadoPor ?? "—"}`}</Dato>
        <Dato etiqueta="Modificado">{`${fechaHora(f.actualizado).slice(0, 10)} por ${f.actualizadoPor ?? "—"}`}</Dato>
        {f.revisado && <Dato etiqueta="Última revisión de los archivos">{`${fechaHora(f.revisado)} por ${f.revisadoPor ?? "—"}`}</Dato>}
      </Bloque>

      <Bloque titulo="Archivos" abierto={abiertas.has("archivos")} onAlternar={() => alternar("archivos")} extra={fila.porRevisar ? <span style={{ color: "#8a5a00", fontWeight: 600 }}>{fila.porRevisar} te tocan</span> : `${fila.archivos}`}>
        <Archivos key={f.id} api={api} projectId={projectId} flujoId={f.id} datos={archivos} error={errorArchivos} onCambio={onCambioArchivos} />
      </Bloque>

      {puede && (
        <div ref={permisosRef}>
          <Bloque titulo="Permisos de Trimble" abierto={abiertas.has("permisos")} onAlternar={() => alternar("permisos")}>
            <Permisos api={api} flujoId={f.id} />
          </Bloque>
        </div>
      )}

      <Bloque titulo="Historial" abierto={abiertas.has("historial")} onAlternar={() => alternar("historial")}>
        <Historial api={api} flujoId={f.id} recarga={recarga} />
      </Bloque>

      <Bloque titulo="Comentarios" abierto={abiertas.has("comentarios")} onAlternar={() => alternar("comentarios")}>
        <Comentarios api={api} flujoId={f.id} />
      </Bloque>
    </div>
  );
}
