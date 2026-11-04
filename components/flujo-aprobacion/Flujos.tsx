"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { describirPasos } from "../../lib/flujo-aprobacion/flujos";
import type { Equipo, EstadoFlujos, Flujo } from "../../lib/flujo-aprobacion/types";
import { botonPeligro, botonSecundario, card, etiqueta, linkBtn, texto } from "../compras/estilos";
import { acceptButton, message, Notice } from "../presupuesto/ui";
import Asignaciones from "./Asignaciones";
import EditorFlujo from "./EditorFlujo";
import Permisos from "./Permisos";

const pequeno = { ...botonSecundario, padding: "4px 12px", fontSize: 13.5 } as const;

/**
 * The project's flows: title or milestone, steps, review folders and
 * destination; each one opens to who does what and Trimble's permissions.
 * Administrators create, edit, deactivate and activate them; everyone else
 * sees them.
 */
export default function Flujos({ api, projectId, datos, onCambio }: { api: FlujoApi; projectId: string; datos: EstadoFlujos; onCambio: (e: EstadoFlujos) => void }) {
  const [editando, setEditando] = useState<Flujo | "nuevo" | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [desactivar, setDesactivar] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!datos.esAdmin || equipo) return;
    api
      .equipo()
      .then(setEquipo)
      .catch((err) => setError(`No se pudo leer el equipo de Trimble: ${message(err)}`));
  }, [api, datos.esAdmin, equipo]);

  async function cambiarEstado(f: Flujo, activo: boolean) {
    setError("");
    try {
      onCambio(await api.cambiarEstado(f.id, f.version, activo));
      setDesactivar(null);
    } catch (err) {
      setError(message(err));
    }
  }

  const activos = datos.flujos.filter((f) => f.activo);
  const inactivos = datos.flujos.filter((f) => !f.activo);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {datos.esAdmin && !editando && (
        <div>
          <button type="button" style={acceptButton} onClick={() => setEditando("nuevo")}>
            + Nuevo flujo
          </button>
        </div>
      )}
      {!datos.esAdmin && <Notice kind="info">Solo los administradores del proyecto en Trimble crean y cambian los flujos; aquí puedes verlos.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {editando && (
        <EditorFlujo
          key={editando === "nuevo" ? "nuevo" : editando.id}
          api={api}
          projectId={projectId}
          flujo={editando === "nuevo" ? null : editando}
          onGuardado={(e) => {
            onCambio(e);
            setEditando(null);
          }}
          onCancelar={() => setEditando(null)}
        />
      )}
      {datos.flujos.length === 0 && !editando && (
        <section style={card}>
          <p style={{ ...texto, margin: 0 }}>
            Todavía no hay flujos en este proyecto.{" "}
            {datos.esAdmin ? "Crea el primero con «+ Nuevo flujo»: su título o hito, las carpetas de revisión, la carpeta destino y los pasos." : ""}
          </p>
        </section>
      )}
      {[...activos, ...inactivos].map((f) => {
        const abiertoAqui = abierto === f.id;
        return (
          <section key={f.id} style={{ ...card, maxWidth: 1000, opacity: f.activo ? 1 : 0.75 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: "var(--tc-blue-800)" }}>{f.hito}</h2>
              {f.activo ? <span style={etiqueta("#1e6b2c", "#e3f4e6")}>Activo</span> : <span style={etiqueta("#5f6b7a", "#eceff3")}>Desactivado</span>}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--tc-gray-700)" }}>
              <div>
                <strong>Pasos:</strong> {describirPasos(f.pasos)}
              </div>
              <div>
                <strong>Revisión:</strong> {f.carpetas.map((c) => c.ruta).join(" · ")}
              </div>
              <div>
                <strong>Destino:</strong> {f.destino.ruta}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                Cambiado por {f.actualizadoPor ?? "—"} el {fechaHora(f.actualizado)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={pequeno} onClick={() => setAbierto(abiertoAqui ? null : f.id)}>
                {abiertoAqui ? "Cerrar" : `Quién hace qué (${f.asignaciones.length})`}
              </button>
              {datos.esAdmin && (
                <button type="button" style={pequeno} onClick={() => setEditando(f)} disabled={!!editando}>
                  Editar
                </button>
              )}
              {datos.esAdmin && f.activo && desactivar !== f.id && (
                <button type="button" style={linkBtn} onClick={() => setDesactivar(f.id)}>
                  Desactivar
                </button>
              )}
              {datos.esAdmin && !f.activo && (
                <button type="button" style={linkBtn} onClick={() => cambiarEstado(f, true)}>
                  Activar
                </button>
              )}
            </div>
            {desactivar === f.id && (
              <Notice kind="warning" style={{ marginTop: 8 }}>
                Al desactivar «{f.hito}» deja de revisar archivos nuevos. No se borra: su configuración y su historial se conservan y se puede volver a activar.
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" style={{ ...botonPeligro, padding: "5px 12px", fontSize: 13.5 }} onClick={() => cambiarEstado(f, false)}>
                    Desactivar
                  </button>
                  <button type="button" style={pequeno} onClick={() => setDesactivar(null)}>
                    No
                  </button>
                </div>
              </Notice>
            )}
            {abiertoAqui && (
              <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
                <Asignaciones api={api} projectId={projectId} flujo={f} esAdmin={datos.esAdmin} equipo={equipo} onCambio={onCambio} />
                {datos.esAdmin && <Permisos api={api} flujoId={f.id} />}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
