"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { describirPasos, diaVisible, PAPEL_CONSULTA, PAPEL_REALIZA } from "../../lib/flujo-aprobacion/flujos";
import type { FilaFlujo } from "../../lib/flujo-aprobacion/lista";
import type { ArchivoInfo, Equipo, EstadoFlujos } from "../../lib/flujo-aprobacion/types";
import { botonPeligro, botonSecundario } from "../compras/estilos";
import { C, message, Notice } from "../presupuesto/ui";
import Archivos from "./Archivos";
import Asignaciones from "./Asignaciones";
import Comentarios from "./Comentarios";
import { descargarTrazabilidad } from "./descargas";
import Historial from "./Historial";
import { EtiquetaEstado } from "./ListaFlujos";
import MenuPuntos from "./MenuPuntos";
import Permisos from "./Permisos";

type Seccion = "detalles" | "archivos" | "quien" | "historial" | "comentarios";

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
 * panels: its state and data, its files (decide there), who does what (and the
 * Trimble permissions), its history and its comments. "⬇" saves its
 * traceability as PDF; the bin deactivates it (it is never deleted).
 */
export default function PanelFlujo({
  api,
  projectId,
  projectName,
  fila,
  datos,
  archivos,
  errorArchivos,
  equipo,
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
  equipo: Equipo | null;
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
  const quienRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDesactivar(pedirDesactivar), [pedirDesactivar, f.id]);
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
    setAbiertas((x) => new Set([...x, "quien"]));
    setTimeout(() => quienRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const porPaso = f.pasos.map((p) => ({
    paso: p.nombre,
    quienes: f.asignaciones.filter((a) => a.activa && a.papel === p.id).map((a) => (a.quienTipo === "grupo" ? `${a.quienNombre} (grupo)` : a.quienNombre)),
  }));
  const realizan = [...new Set(f.asignaciones.filter((a) => a.activa && a.papel === PAPEL_REALIZA).map((a) => (a.quienTipo === "grupo" ? `${a.quienNombre} (grupo)` : a.quienNombre)))];
  const consultan = [...new Set(f.asignaciones.filter((a) => a.activa && a.papel === PAPEL_CONSULTA).map((a) => (a.quienTipo === "grupo" ? `${a.quienNombre} (grupo)` : a.quienNombre)))];

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
        {datos.esAdmin && f.activo && (
          <button type="button" onClick={() => setDesactivar(true)} style={icono} title="Desactivar el flujo (no se borra)" aria-label="Desactivar">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 6h10l-.8 10.2a1 1 0 0 1-1 .8H6.8a1 1 0 0 1-1-.8zM3.5 6h13M8 6V4h4v2" stroke="#4b5563" strokeWidth="1.7" fill="#6b7280" fillOpacity=".25" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <MenuPuntos
          opciones={[
            { texto: "Editar", onClick: onEditar, oculto: !datos.esAdmin },
            { texto: "Revisar permisos de Trimble", onClick: verPermisos, oculto: !datos.esAdmin },
            { texto: "Activar", onClick: () => void cambiarEstado(true), oculto: !datos.esAdmin || f.activo },
            { texto: "Desactivar…", onClick: () => setDesactivar(true), oculto: !datos.esAdmin || !f.activo, peligro: true },
          ]}
        />
      </div>
      {desactivar && (
        <Notice kind="warning" style={{ margin: "0 16px 10px" }}>
          Al desactivar «{f.hito}» deja de revisar archivos nuevos. No se borra: su configuración, sus archivos y su historial se conservan y se puede volver a activar.
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
        <div style={{ marginBottom: 10 }}>
          <EtiquetaEstado estado={fila.estado} />
        </div>
        <Dato etiqueta="Fecha de vencimiento">{f.vence ? <span style={{ color: fila.estado === "vencido" ? "#c0392b" : undefined }}>{diaVisible(f.vence)}{fila.estado === "vencido" ? " (vencido, con archivos por revisar)" : ""}</span> : "Sin fecha"}</Dato>
        <Dato etiqueta="Pasos">{describirPasos(f.pasos)}</Dato>
        <Dato etiqueta="Responsables">
          {porPaso.map((p) => (
            <div key={p.paso}>
              <strong>{p.paso}:</strong> {p.quienes.length ? p.quienes.join(", ") : <span style={{ color: "var(--tc-gray-500)" }}>sin asignar (solo administradores)</span>}
            </div>
          ))}
          {realizan.length > 0 && (
            <div>
              <strong>Realiza:</strong> {realizan.join(", ")}
            </div>
          )}
          {consultan.length > 0 && (
            <div>
              <strong>Consulta:</strong> {consultan.join(", ")}
            </div>
          )}
        </Dato>
        <Dato etiqueta="Carpetas de revisión">
          {f.carpetas.map((c) => (
            <div key={c.id}>{c.ruta}</div>
          ))}
        </Dato>
        <Dato etiqueta="Carpeta destino">{f.destino.ruta}</Dato>
        <Dato etiqueta="Archivos">
          {fila.archivos} registrados · {fila.pendientes} por revisar{fila.porRevisar ? ` (${fila.porRevisar} te tocan)` : ""}
        </Dato>
        {f.notas && <Dato etiqueta="Notas"><span style={{ whiteSpace: "pre-wrap" }}>{f.notas}</span></Dato>}
        <Dato etiqueta="Creado/a">{`${fechaHora(f.creado).slice(0, 10)} por ${f.creadoPor ?? "—"}`}</Dato>
        <Dato etiqueta="Modificado">{`${fechaHora(f.actualizado).slice(0, 10)} por ${f.actualizadoPor ?? "—"}`}</Dato>
        {f.revisado && <Dato etiqueta="Última revisión de las carpetas">{`${fechaHora(f.revisado)} por ${f.revisadoPor ?? "—"}`}</Dato>}
      </Bloque>

      <Bloque titulo="Archivos" abierto={abiertas.has("archivos")} onAlternar={() => alternar("archivos")} extra={fila.porRevisar ? <span style={{ color: "#8a5a00", fontWeight: 600 }}>{fila.porRevisar} te tocan</span> : `${fila.archivos}`}>
        <Archivos key={f.id} api={api} flujoId={f.id} datos={archivos} error={errorArchivos} onCambio={onCambioArchivos} />
      </Bloque>

      <div ref={quienRef}>
        <Bloque titulo="Quién hace qué" abierto={abiertas.has("quien")} onAlternar={() => alternar("quien")} extra={`${f.asignaciones.length}`}>
          <Asignaciones api={api} projectId={projectId} flujo={f} esAdmin={datos.esAdmin} equipo={equipo} onCambio={onCambio} />
          {datos.esAdmin && (
            <div style={{ marginTop: 12 }}>
              <Permisos api={api} flujoId={f.id} />
            </div>
          )}
        </Bloque>
      </div>

      <Bloque titulo="Historial" abierto={abiertas.has("historial")} onAlternar={() => alternar("historial")}>
        <Historial api={api} flujoId={f.id} recarga={recarga} />
      </Bloque>

      <Bloque titulo="Comentarios" abierto={abiertas.has("comentarios")} onAlternar={() => alternar("comentarios")}>
        <Comentarios api={api} flujoId={f.id} />
      </Bloque>
    </div>
  );
}
