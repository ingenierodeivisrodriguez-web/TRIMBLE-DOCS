"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import type { Disciplina, EstadoResponse, Plantilla } from "../../lib/loin/types";
import { fecha } from "../../lib/presupuesto/format";
import { acceptButton, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, campo, h3, inactivo, linkBtn, parrafo, select } from "./estilos";

/**
 * Discipline templates of the catalog's base project: copy one into this
 * project, or save one of this project's disciplines as a template.
 */
export default function PlantillasDialog({
  api,
  estado,
  disciplinas,
  onAplicada,
  onClose,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  disciplinas: Disciplina[];
  onAplicada: (texto: string) => void;
  onClose: () => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [inactivas, setInactivas] = useState(false);
  const activas = disciplinas.filter((d) => d.activo);
  const [nueva, setNueva] = useState({ disciplinaId: activas[0]?.id ?? "", nombre: "", descripcion: "" });

  const cargar = useCallback(async () => {
    try {
      setPlantillas(await api.listPlantillas());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function correr(accion: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const texto = await accion();
      if (texto) setOk(texto);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const visibles = (plantillas ?? []).filter((p) => inactivas || p.activo);

  return (
    <Modal title="Plantillas de disciplina" onClose={() => !busy && onClose()} width={860}>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ ...parrafo, color: "var(--tc-gray-500)" }}>
          Una plantilla guarda una disciplina completa (sus elementos, parámetros exigidos, notas de modelado e imágenes) en el proyecto base del catálogo
          {estado.esBasePropia ? " (este proyecto)" : ` (${estado.config.baseProjectName || estado.config.baseProjectId})`}. Cualquier proyecto que use la misma base la puede copiar; la copia es
          independiente: cambiarla no cambia la plantilla ni otros proyectos.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="info">{ok}</Notice>}

        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ ...h3, margin: 0 }}>Plantillas disponibles</h3>
            {estado.canEditBase && (
              <label style={{ fontSize: 13, display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Ver desactivadas
              </label>
            )}
          </div>
          {!plantillas && !error && <p style={ayuda}>Cargando…</p>}
          {plantillas && visibles.length === 0 && <p style={ayuda}>No hay plantillas todavía.</p>}
          {visibles.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.grid}`, opacity: p.activo ? 1 : 0.55 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: p.contenido.disciplina.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14 }}>
                <strong>{p.nombre}</strong> {!p.activo && <span style={inactivo}>Desactivada</span>}
                <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                  {p.contenido.disciplina.codigo} · {p.contenido.disciplina.nombre} · {p.contenido.elementos.length} elemento(s) · creada {fecha(p.creada).slice(0, 10)}
                  {p.creadaPor ? ` por ${p.creadaPor}` : ""}
                  {p.descripcion ? ` · ${p.descripcion}` : ""}
                </span>
              </span>
              {estado.canEdit && p.activo && (
                <button
                  type="button"
                  style={botonSecundario}
                  disabled={busy}
                  onClick={() =>
                    correr(async () => {
                      const r = await api.aplicarPlantilla(p.id);
                      const avisos = [
                        r.parametrosQuitados ? `${r.parametrosQuitados} parámetro(s) exigido(s) no están en el catálogo de este proyecto y se dejaron fuera` : "",
                        r.imagenesOmitidas ? `${r.imagenesOmitidas} imagen(es) no se pudieron copiar` : "",
                      ].filter(Boolean);
                      const texto = `Listo: se creó la disciplina ${r.disciplina.codigo} con ${r.elementos} elemento(s).${avisos.length ? ` Ojo: ${avisos.join("; ")}.` : ""}`;
                      onAplicada(texto);
                      return texto;
                    })
                  }
                >
                  Usar en este proyecto
                </button>
              )}
              {estado.canEditBase && (
                <button
                  type="button"
                  style={linkBtn}
                  disabled={busy}
                  onClick={() =>
                    correr(async () => {
                      await api.cambiarPlantilla({ id: p.id, version: p.version, activo: !p.activo });
                      await cargar();
                      return p.activo ? `La plantilla "${p.nombre}" quedó desactivada (no se borra).` : `La plantilla "${p.nombre}" está activa de nuevo.`;
                    })
                  }
                >
                  {p.activo ? "Desactivar" : "Activar"}
                </button>
              )}
            </div>
          ))}
        </section>

        {estado.canEditBase ? (
          <section style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: 12 }}>
            <h3 style={h3}>Guardar una disciplina de este proyecto como plantilla</h3>
            {activas.length === 0 ? (
              <p style={ayuda}>No hay disciplinas activas en este proyecto.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <span style={labelStyle}>Disciplina</span>
                  <select value={nueva.disciplinaId} onChange={(e) => setNueva({ ...nueva, disciplinaId: e.target.value })} style={{ ...select, width: "100%" }} aria-label="Disciplina">
                    {activas.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.codigo} · {d.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={labelStyle}>Nombre de la plantilla</span>
                  <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} maxLength={120} placeholder="Arquitectura vivienda DYCO" style={campo} aria-label="Nombre de la plantilla" />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span style={labelStyle}>Descripción (opcional)</span>
                  <input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} maxLength={1000} style={campo} aria-label="Descripción de la plantilla" />
                </label>
                <div>
                  <button
                    type="button"
                    style={acceptButton}
                    disabled={busy || !nueva.disciplinaId || !nueva.nombre.trim()}
                    onClick={() =>
                      correr(async () => {
                        const r = await api.crearPlantilla(nueva);
                        await cargar();
                        setNueva({ ...nueva, nombre: "", descripcion: "" });
                        return `Plantilla "${r.plantilla.nombre}" guardada con ${r.plantilla.contenido.elementos.length} elemento(s).${r.imagenesOmitidas ? ` ${r.imagenesOmitidas} imagen(es) no se pudieron copiar.` : ""}`;
                      })
                    }
                  >
                    Guardar como plantilla
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <p style={ayuda}>{estado.baseNote.replace("El catálogo de parámetros es", "Las plantillas son").replace("lo modifican", "las guardan")}</p>
        )}
      </div>
    </Modal>
  );
}
