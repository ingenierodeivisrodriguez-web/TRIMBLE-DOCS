"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { EntradaHistorial, Flujo } from "../../lib/flujo-aprobacion/types";
import { card, select, td, texto, th, titulo } from "../compras/estilos";
import { C, labelStyle, message, Notice } from "../presupuesto/ui";

const ACCIONES: Record<string, string> = {
  "flujo-creado": "Creó el flujo",
  "flujo-modificado": "Cambió el flujo",
  "flujo-desactivado": "Desactivó el flujo",
  "flujo-activado": "Activó el flujo",
  "asignacion-agregada": "Asignó",
  "asignacion-quitada": "Quitó una asignación",
  "archivo-detectado": "Subió un archivo",
  "version-reemplazada": "Subió otra versión",
  "nueva-version": "Subió una versión nueva",
  "archivo-retirado": "Archivo retirado",
  "archivo-reaparecido": "Archivo que vuelve",
  "archivo-cambio-flujo": "Archivo que cambió de flujo",
  "aprobado-paso": "Aprobó un paso",
  aprobado: "Aprobó",
  rechazado: "Rechazó",
  "aviso-enviado": "Avisó (tarea de Trimble)",
  "aviso-fallido": "Aviso no enviado",
};

/** Everything that changed in the configuration, newest first; it is never edited or deleted. */
export default function Historial({ api, flujos, recarga }: { api: FlujoApi; flujos: Flujo[]; recarga: number }) {
  const [flujoId, setFlujoId] = useState("");
  const [entradas, setEntradas] = useState<EntradaHistorial[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    api
      .historial(flujoId || undefined)
      .then((r) => vigente && (setEntradas(r.entradas), setError("")))
      .catch((err) => vigente && setError(message(err)));
    return () => {
      vigente = false;
    };
  }, [api, flujoId, recarga]);

  const hitoDe = (id: string | null) => flujos.find((f) => f.id === id)?.hito ?? "";

  return (
    <section style={{ ...card, maxWidth: 1100 }}>
      <h2 style={titulo}>Historial</h2>
      <p style={texto}>
        Quién creó, cambió, activó o desactivó cada flujo, quién asignó o quitó papeles, y qué archivos y versiones se subieron (con la fecha de Trimble). No se edita ni se
        borra. Incluye cada aprobación y rechazo con su comentario, y los avisos enviados.
      </p>
      <label style={{ display: "inline-block", marginBottom: 8 }}>
        <span style={labelStyle}>Flujo</span>
        <select value={flujoId} onChange={(e) => setFlujoId(e.target.value)} style={{ ...select, minWidth: 280 }}>
          <option value="">Todos</option>
          {flujos.map((f) => (
            <option key={f.id} value={f.id}>
              {f.hito}
            </option>
          ))}
        </select>
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      {entradas && entradas.length === 0 && <p style={{ ...texto, margin: 0 }}>Todavía no hay nada en el historial.</p>}
      {entradas && entradas.length > 0 && (
        <div style={{ maxHeight: 480, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Fecha</th>
                <th style={th}>Quién</th>
                <th style={th}>Qué</th>
                {!flujoId && <th style={th}>Flujo</th>}
                <th style={th}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }} title={e.ocurrido ? `Anotado el ${fechaHora(e.creado)}` : undefined}>
                    {fechaHora(e.ocurrido ?? e.creado)}
                  </td>
                  <td style={td}>{e.usuario ?? ""}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{ACCIONES[e.accion] ?? e.accion}</td>
                  {!flujoId && <td style={td}>{hitoDe(e.flujoId)}</td>}
                  <td style={td}>{e.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
