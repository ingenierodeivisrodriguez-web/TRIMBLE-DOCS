"use client";

import { CSSProperties, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { etapasOrdenadas, fechaCorta } from "../../lib/loin/matriz";
import type { Etapa } from "../../lib/loin/types";
import { parseDisplayDate } from "../../lib/propiedades/values";
import DateField from "../propiedades/DateField";
import { acceptButton, C, message, Modal, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, campo, inactivo, linkBtn, td, th } from "./estilos";

interface Fila {
  id: string;
  version: number;
  codigo: string;
  nombre: string;
  /** As typed, DD-MM-AAAA. */
  fechaTexto: string;
  orden: number;
  activo: boolean;
  cambiada: boolean;
}

const desde = (e: Etapa): Fila => ({ id: e.id, version: e.version, codigo: e.codigo, nombre: e.nombre, fechaTexto: fechaCorta(e.fecha), orden: e.orden, activo: e.activo, cambiada: false });

/** The project's stages (milestones): code, name, date and order. They are deactivated, never deleted. */
export default function EtapasDialog({ api, etapas, puedeEditar, onCambio, onClose }: { api: LoinApi; etapas: Etapa[]; puedeEditar: boolean; onCambio: () => Promise<void>; onClose: () => void }) {
  const [filas, setFilas] = useState<Fila[]>(() => etapasOrdenadas(etapas, true).map(desde));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const ro = !puedeEditar;
  const cambiar = (i: number, patch: Partial<Fila>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch, cambiada: true } : f)));

  function mover(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= filas.length) return;
    const lista = [...filas];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    // The order is the position: renumber the two that moved.
    setFilas(lista.map((f, k) => (k === i || k === j ? { ...f, orden: k + 1, cambiada: true } : f)));
  }

  async function recargar(texto: string) {
    await onCambio();
    setOk(texto);
  }

  async function guardar() {
    setError("");
    setOk("");
    const cambiadas = filas.map((f, i) => ({ f, i })).filter(({ f }) => f.cambiada);
    for (const { f } of cambiadas) {
      if (!f.codigo.trim() || !f.nombre.trim()) return setError("Cada etapa necesita código y nombre.");
      if (f.fechaTexto.trim() && !parseDisplayDate(f.fechaTexto)) return setError(`La fecha de ${f.codigo} no es válida (DD-MM-AAAA).`);
    }
    setBusy("Guardando…");
    try {
      let lista = [...filas];
      for (const { f, i } of cambiadas) {
        const e = await api.guardarEtapa({
          id: f.id,
          version: f.version,
          codigo: f.codigo,
          nombre: f.nombre,
          fecha: f.fechaTexto.trim() ? parseDisplayDate(f.fechaTexto) : null,
          orden: f.orden,
          activo: f.activo,
        });
        lista = lista.map((x, k) => (k === i ? desde(e) : x));
        setFilas(lista);
      }
      await recargar(`${cambiadas.length} etapa(s) guardada(s).`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }

  async function sugeridas() {
    setBusy("Cargando…");
    setError("");
    try {
      const r = await api.cargarEtapasSugeridas();
      const { etapas: nuevas } = await api.getMatriz();
      setFilas(etapasOrdenadas(nuevas, true).map(desde));
      await recargar(r.etapas ? `${r.etapas} etapa(s) agregada(s). Ponles la fecha de cada hito.` : "Las etapas sugeridas ya estaban (se reconocen por su código).");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }

  const pendientes = filas.some((f) => f.cambiada);

  return (
    <Modal
      title="Etapas del proyecto"
      onClose={() => !busy && onClose()}
      width={860}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{busy}</span>
          <button type="button" style={botonSecundario} onClick={onClose} disabled={!!busy}>
            {pendientes && !ro ? "Cerrar sin guardar" : "Cerrar"}
          </button>
          {!ro && (
            <button type="button" style={acceptButton} onClick={guardar} disabled={!!busy || !pendientes}>
              Guardar cambios
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={ayuda}>
          Los hitos en los que se entrega información (ISO 7817-1 los llama hitos de entrega). La matriz muestra las etapas activas en este orden. Las etapas no se borran: se desactivan.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="info">{ok}</Notice>}
        {!ro && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={botonSecundario}
              disabled={!!busy}
              onClick={() =>
                setFilas((fs) => [...fs, { id: crypto.randomUUID(), version: 0, codigo: "", nombre: "", fechaTexto: "", orden: fs.length + 1, activo: true, cambiada: true }])
              }
            >
              + Etapa
            </button>
            <button type="button" style={botonSecundario} disabled={!!busy || pendientes} onClick={sugeridas} title="Anteproyecto, Proyecto / diseño de detalle, Licencia, Construcción y As-built / entrega a operación">
              Cargar etapas sugeridas
            </button>
          </div>
        )}
        <div style={{ border: `1px solid ${C.border}`, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Orden</th>
                <th style={th}>Código</th>
                <th style={th}>Nombre</th>
                <th style={th}>Fecha del hito</th>
                <th style={th}>Activa</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>
                    Sin etapas todavía.
                  </td>
                </tr>
              )}
              {filas.map((f, i) => (
                <tr key={f.id} style={{ background: f.cambiada ? "#fffbe6" : undefined, opacity: f.activo ? 1 : 0.6 }}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {i + 1}
                    {!ro && (
                      <>
                        <button type="button" style={mini} onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">
                          ↑
                        </button>
                        <button type="button" style={mini} onClick={() => mover(i, 1)} disabled={i === filas.length - 1} aria-label="Bajar">
                          ↓
                        </button>
                      </>
                    )}
                  </td>
                  <td style={{ ...td, width: 110 }}>
                    <input value={f.codigo} onChange={(e) => cambiar(i, { codigo: e.target.value.toUpperCase() })} readOnly={ro} maxLength={20} style={campo} aria-label="Código de la etapa" />
                  </td>
                  <td style={td}>
                    <input value={f.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} readOnly={ro} maxLength={120} style={campo} aria-label="Nombre de la etapa" />
                  </td>
                  <td style={{ ...td, width: 170 }}>
                    {ro ? (
                      f.fechaTexto || "—"
                    ) : (
                      <DateField
                        id={`etapa-fecha-${f.id}`}
                        text={f.fechaTexto}
                        placeholder="DD-MM-AAAA"
                        invalid={!!f.fechaTexto.trim() && !parseDisplayDate(f.fechaTexto)}
                        onText={(t) => cambiar(i, { fechaTexto: t })}
                      />
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <input type="checkbox" checked={f.activo} onChange={(e) => cambiar(i, { activo: e.target.checked })} disabled={ro} aria-label={`Etapa ${f.codigo} activa`} />
                    {!f.activo && <span style={{ ...inactivo, marginLeft: 6 }}>Inactiva</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pendientes && !ro && (
          <p style={ayuda}>
            Hay cambios sin guardar (filas en amarillo).{" "}
            <button type="button" style={linkBtn} onClick={() => setFilas(etapasOrdenadas(etapas, true).map(desde))}>
              Descartarlos
            </button>
          </p>
        )}
      </div>
    </Modal>
  );
}

const mini: CSSProperties = { border: "1px solid #d6dbe1", background: "#fff", borderRadius: 3, padding: "0 6px", marginLeft: 4, cursor: "pointer", fontFamily: "inherit", fontSize: 12 };
