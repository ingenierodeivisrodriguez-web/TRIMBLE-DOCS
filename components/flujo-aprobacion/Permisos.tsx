"use client";

import { useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { AvisoPermisos, PermisosCarpeta } from "../../lib/flujo-aprobacion/types";
import { botonSecundario, subtitulo, td, th } from "../compras/estilos";
import { C, message, Notice } from "../presupuesto/ui";

const TIPO: Record<AvisoPermisos["tipo"], "warning" | "error" | "info"> = { riesgo: "warning", falla: "error", info: "info" };

/** The permissions of the folders where the flow's files are, as Trimble lists them, with warnings. Read only: nothing is changed in Trimble. */
export default function Permisos({ api, flujoId }: { api: FlujoApi; flujoId: string }) {
  const [datos, setDatos] = useState<{ avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] } | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function revisar() {
    setOcupado(true);
    setError("");
    try {
      setDatos(await api.permisos(flujoId));
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <h3 style={subtitulo}>Permisos en Trimble</h3>
      <p style={{ margin: "0 0 6px", fontSize: 13.5, color: "var(--tc-gray-700)" }}>
        La extensión lee los permisos de las carpetas donde están los archivos del flujo y avisa si un responsable no podría abrirlos; no los cambia. Si algo no cuadra, ajústalo en Trimble (Explorador → carpeta → Permisos).
      </p>
      <button type="button" onClick={revisar} disabled={ocupado} style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }}>
        {ocupado ? "Leyendo permisos…" : datos ? "Revisar otra vez" : "Revisar permisos de Trimble"}
      </button>
      {error && (
        <Notice kind="error" style={{ marginTop: 8 }}>
          {error}
        </Notice>
      )}
      {datos && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {datos.avisos.length === 0 && <Notice kind="info">Sin avisos: los responsables de cada paso aparecen con acceso a las carpetas de los archivos.</Notice>}
          {datos.avisos.map((a) => (
            <Notice key={a.texto} kind={TIPO[a.tipo]}>
              {a.texto}
            </Notice>
          ))}
          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Carpeta</th>
                  <th style={th}>Acceso completo</th>
                  <th style={th}>Ver y descargar</th>
                  <th style={th}>Sin acceso</th>
                </tr>
              </thead>
              <tbody>
                {datos.carpetas.map((c) => (
                  <tr key={`${c.papel}-${c.ruta}`}>
                    <td style={td}>
                      {c.ruta}
                      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{c.papel === "destino" ? "Carpeta destino (flujo anterior)" : "Carpeta con archivos del flujo"}</div>
                    </td>
                    <td style={td}>{c.completo.join(", ") || "—"}</td>
                    <td style={td}>{c.lectura.join(", ") || "—"}</td>
                    <td style={td}>{c.sinAcceso.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
