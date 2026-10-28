"use client";

import { useCallback, useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { PublicarApi } from "../../lib/publicar/client";
import { proyectoDeEnlace } from "../../lib/publicar/formato";
import type { ProyectoInfo, PublicacionInfo, Recepcion } from "../../lib/publicar/types";
import { acceptButton, baseInput, labelStyle, message, Notice } from "../presupuesto/ui";
import { botonSecundario, card, etiqueta, select, td, texto, th, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "./Explorador";
import ListaPublicaciones from "./ListaPublicaciones";

const OTRO = "__otro__";

/**
 * "Recibido en este proyecto" (this project is the destination): the
 * reception folders, one per origin project, that its administrators
 * define; and what other projects publish here.
 */
export default function RecibidoTab({
  api,
  projectId,
  publicaciones,
  yo,
  esAdmin,
  onCambio,
}: {
  api: PublicarApi;
  projectId: string;
  publicaciones: PublicacionInfo[];
  yo: string;
  esAdmin: boolean;
  onCambio: () => void;
}) {
  const [recepciones, setRecepciones] = useState<Recepcion[] | null>(null);
  const [proyectos, setProyectos] = useState<ProyectoInfo[]>([]);
  const [editando, setEditando] = useState(false);
  const [origen, setOrigen] = useState("");
  const [enlace, setEnlace] = useState("");
  const [carpeta, setCarpeta] = useState<Elegido | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    api
      .recepciones()
      .then((r) => setRecepciones(r.recepciones))
      .catch((err) => setError(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
    api
      .proyectos()
      .then((r) => setProyectos(r.proyectos.filter((p) => !p.actual)))
      .catch(() => setProyectos([]));
  }, [api, cargar]);

  const origenElegido = origen === OTRO ? proyectoDeEnlace(enlace) : origen || null;
  const listo = !!origenElegido && !!carpeta && !busy;

  function abrirFormulario(r?: Recepcion) {
    setEditando(true);
    setCarpeta(null);
    setError("");
    if (r) {
      const conocido = proyectos.some((p) => p.id === r.origenProyecto);
      setOrigen(conocido ? r.origenProyecto : OTRO);
      setEnlace(conocido ? "" : r.origenProyecto);
    } else {
      setOrigen("");
      setEnlace("");
    }
  }

  async function guardar() {
    if (!listo || !origenElegido || !carpeta) return;
    setBusy(true);
    setError("");
    try {
      const nombre = proyectos.find((p) => p.id === origenElegido)?.nombre;
      const r = await api.guardarRecepcion(origenElegido, carpeta.id, nombre);
      setRecepciones(r.recepciones);
      setEditando(false);
      onCambio();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function desactivar(r: Recepcion) {
    if (!window.confirm(`¿Dejar de recibir publicaciones nuevas de ${r.origenNombre || r.origenProyecto}? Lo ya publicado sigue actualizándose donde está.`)) return;
    setBusy(true);
    setError("");
    try {
      setRecepciones((await api.desactivarRecepcion(r.origenProyecto)).recepciones);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const haciaAqui = publicaciones.filter((p) => p.destinoProyecto === projectId);

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Configuración del proyecto destino: carpetas de recepción</h2>
        <p style={texto}>
          Para cada proyecto que publica aquí, la carpeta donde llega lo que publica. La define un administrador de este proyecto; cambiarla solo afecta lo que se publique
          después.
        </p>
        {recepciones === null ? (
          <p style={{ ...texto, color: "var(--tc-gray-500)" }}>Cargando…</p>
        ) : recepciones.length === 0 ? (
          <p style={{ ...texto, color: "var(--tc-gray-500)" }}>Todavía no hay carpetas de recepción.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={th}>Proyecto origen</th>
                <th style={th}>Carpeta de recepción</th>
                <th style={th}>Definida por</th>
                {esAdmin && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {recepciones.map((r) => (
                <tr key={r.id} style={{ opacity: r.activa ? 1 : 0.6 }}>
                  <td style={td}>
                    {r.origenNombre || r.origenProyecto} {!r.activa && <span style={etiqueta("#5b6573", "#eef1f5")}>Desactivada</span>}
                  </td>
                  <td style={{ ...td, wordBreak: "break-word" }}>{r.carpetaRuta}</td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                    {r.actualizadoPor ?? "sin dato"}
                    <br />
                    {fechaHora(r.actualizado)}
                  </td>
                  {esAdmin && (
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button type="button" disabled={busy} onClick={() => abrirFormulario(r)} style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5 }}>
                        {r.activa ? "Cambiar carpeta" : "Activar"}
                      </button>{" "}
                      {r.activa && (
                        <button type="button" disabled={busy} onClick={() => desactivar(r)} style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5 }}>
                          Desactivar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!esAdmin ? (
          <Notice kind="info">Las carpetas de recepción las define un administrador de este proyecto en Trimble Connect.</Notice>
        ) : !editando ? (
          <button type="button" onClick={() => abrirFormulario()} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            Agregar proyecto origen
          </button>
        ) : (
          <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--tc-gray-300)", paddingTop: 12 }}>
            <div>
              <label style={labelStyle} htmlFor="origen-recepcion">
                Proyecto origen (el que publica aquí)
              </label>
              <select id="origen-recepcion" value={origen} onChange={(e) => setOrigen(e.target.value)} style={{ ...select, minWidth: 320 }}>
                <option value="">Elige el proyecto…</option>
                {proyectos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
                <option value={OTRO}>Otro proyecto (pegar su enlace)…</option>
              </select>
              {origen === OTRO && (
                <input
                  value={enlace}
                  onChange={(e) => setEnlace(e.target.value)}
                  placeholder="https://web.connect.trimble.com/projects/…"
                  style={{ ...baseInput, width: "100%", marginTop: 6 }}
                  aria-label="Enlace o id del proyecto origen"
                />
              )}
              {origen === OTRO && enlace && !origenElegido && <div style={{ fontSize: 12.5, color: "#b3261e", marginTop: 4 }}>Pega la dirección del proyecto (la que contiene /projects/...) o su id.</div>}
            </div>
            <div>
              <div style={labelStyle}>Carpeta de este proyecto donde llega lo que publique</div>
              <Explorador api={api} proyecto={projectId} elegir="carpeta" seleccionados={carpeta ? [carpeta.id] : []} onElegir={setCarpeta} />
              {carpeta && (
                <div style={{ fontSize: 13.5, marginTop: 6 }}>
                  Carpeta elegida: <strong>{carpeta.ruta}</strong>
                </div>
              )}
            </div>
            <div>
              <button type="button" onClick={guardar} disabled={!listo} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, opacity: listo ? 1 : 0.5 }}>
                {busy ? "Guardando…" : "Guardar carpeta de recepción"}
              </button>{" "}
              <button type="button" onClick={() => setEditando(false)} disabled={busy} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {error && (
          <Notice kind="error" style={{ marginTop: 10 }}>
            {error}
          </Notice>
        )}
      </section>

      <section style={card}>
        <h2 style={titulo}>Publicado hacia este proyecto</h2>
        <ListaPublicaciones api={api} publicaciones={haciaAqui} lado="desde" yo={yo} esAdmin={esAdmin} onCambio={onCambio} />
      </section>
    </div>
  );
}
