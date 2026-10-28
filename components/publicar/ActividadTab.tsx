"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { PublicarApi } from "../../lib/publicar/client";
import { ACCION, filtrarActividad, versiones } from "../../lib/publicar/formato";
import type { AccionActividad, EntradaActividad } from "../../lib/publicar/types";
import { baseInput, labelStyle, message, Notice } from "../presupuesto/ui";
import { card, select, td, th, titulo } from "../compras/estilos";

const COLOR: Record<EntradaActividad["resultado"], string> = { ok: "var(--tc-gray-700)", aviso: "#8a5a00", error: "#b3261e" };

/**
 * "Actividad": everything published from or to this project, with date,
 * user, version and note, newest first. Days are filtered on the server;
 * the kind and the text, on screen.
 */
export default function ActividadTab({ api, recarga }: { api: PublicarApi; recarga: number }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [accion, setAccion] = useState<AccionActividad | "">("");
  const [buscar, setBuscar] = useState("");
  const [entradas, setEntradas] = useState<EntradaActividad[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    setError("");
    api
      .actividad(desde || undefined, hasta || undefined)
      .then((r) => vigente && setEntradas(r.entradas))
      .catch((err) => vigente && setError(message(err)));
    return () => {
      vigente = false;
    };
  }, [api, desde, hasta, recarga]);

  const vistas = entradas ? filtrarActividad(entradas, { accion, texto: buscar }) : [];

  return (
    <section style={{ ...card, maxWidth: 1100 }}>
      <h2 style={titulo}>Actividad</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="act-desde">
            Desde
          </label>
          <input id="act-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={baseInput} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="act-hasta">
            Hasta
          </label>
          <input id="act-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={baseInput} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="act-accion">
            Qué pasó
          </label>
          <select id="act-accion" value={accion} onChange={(e) => setAccion(e.target.value as AccionActividad | "")} style={select}>
            <option value="">Todo</option>
            {(Object.keys(ACCION) as AccionActividad[]).map((k) => (
              <option key={k} value={k}>
                {ACCION[k]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={labelStyle} htmlFor="act-buscar">
            Buscar (usuario, documento, proyecto o nota)
          </label>
          <input id="act-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: "100%" }} />
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {entradas === null ? (
        <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>
      ) : vistas.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>No hay actividad con esos filtros.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Fecha</th>
                <th style={th}>Usuario</th>
                <th style={th}>Qué pasó</th>
                <th style={th}>Documento</th>
                <th style={th}>Versión</th>
                <th style={th}>Proyectos</th>
                <th style={th}>Notas</th>
              </tr>
            </thead>
            <tbody>
              {vistas.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fechaHora(e.creado)}</td>
                  <td style={td}>{e.usuario ?? ""}</td>
                  <td style={{ ...td, color: COLOR[e.resultado], whiteSpace: "nowrap" }}>{ACCION[e.accion] ?? e.accion}</td>
                  <td style={{ ...td, wordBreak: "break-word" }}>{e.nombre}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }} title="Versión en el origen → versión en el destino">
                    {versiones(e.versionOrigen, e.versionDestino)}
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {e.origenNombre || e.origenProyecto} → {e.destinoNombre || e.destinoProyecto}
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{e.nota}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entradas.length >= 1000 && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Se muestran las 1000 más recientes: usa las fechas para ver otras.</p>}
        </div>
      )}
    </section>
  );
}
