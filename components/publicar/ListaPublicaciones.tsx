"use client";

import { useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { PublicarApi } from "../../lib/publicar/client";
import { ESTADO_ARCHIVO, ESTADO_PUBLICACION, textoConteo, versiones } from "../../lib/publicar/formato";
import type { ArchivoSeguido, PublicacionInfo } from "../../lib/publicar/types";
import { C, message, Notice } from "../presupuesto/ui";
import { botonSecundario, etiqueta, td } from "../compras/estilos";
import { copiarSeguido } from "./Sincronizacion";

/**
 * The publications seen from this project: as origin ("hacia": where each one
 * goes) or as destination ("desde": where each one comes from), with their
 * files. A file that differs in the destination is replaced only when a
 * person presses its button and confirms.
 */
export default function ListaPublicaciones({
  api,
  publicaciones,
  lado,
  yo,
  esAdmin,
  onCambio,
}: {
  api: PublicarApi;
  publicaciones: PublicacionInfo[];
  lado: "hacia" | "desde";
  yo: string;
  esAdmin: boolean;
  onCambio: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<Record<string, string>>({});

  async function estado(p: PublicacionInfo, accion: "detener" | "reanudar") {
    if (accion === "detener" && !window.confirm(`¿Dejar de actualizar “${p.nombre}” en ${p.destinoNombre}? Lo ya copiado queda en el destino.`)) return;
    setOcupado(p.id);
    setError("");
    try {
      await api.cambiarEstado(p.id, accion);
      onCambio();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(null);
    }
  }

  async function reemplazar(p: PublicacionInfo, a: ArchivoSeguido) {
    if (!a.diferenciaVersionId) return;
    if (!window.confirm(`En ${p.destinoNombre}, “${a.nombre}” tiene otro contenido.\n\n${a.mensaje}\n\n¿Subir encima la versión de ${p.origenNombre} como versión nueva? La versión que hay en el destino queda en su historial.`)) return;
    setOcupado(a.id);
    setError("");
    try {
      const r = await copiarSeguido(api, a.id, a.diferenciaVersionId);
      setAvisos((x) => ({ ...x, [a.id]: r.mensaje }));
      onCambio();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(null);
    }
  }

  if (!publicaciones.length) {
    return <p style={{ margin: 0, fontSize: 13.5, color: "var(--tc-gray-500)" }}>{lado === "hacia" ? "Todavía no se ha publicado nada desde este proyecto." : "Todavía no se ha publicado nada hacia este proyecto."}</p>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error && <Notice kind="error">{error}</Notice>}
      {publicaciones.map((p) => {
        const e = ESTADO_PUBLICACION[p.estado];
        const puede = p.publicadoPorId === yo || esAdmin;
        return (
          <div key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 14 }}>
                {p.tipo === "carpeta" ? "Carpeta " : ""}
                {p.nombre}
              </strong>
              <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
              <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{lado === "hacia" ? `→ ${p.destinoNombre}` : `← ${p.origenNombre}`}</span>
              <span style={{ flex: 1 }} />
              {puede && p.estado === "activa" && (
                <button type="button" disabled={!!ocupado} onClick={() => estado(p, "detener")} style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5 }}>
                  Dejar de actualizar
                </button>
              )}
              {puede && p.estado === "detenida" && (
                <button type="button" disabled={!!ocupado} onClick={() => estado(p, "reanudar")} style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5 }}>
                  Reanudar
                </button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 3, lineHeight: 1.5 }}>
              {lado === "hacia" ? `De: ${p.ruta}` : `Origen: ${p.ruta}`}
              <br />
              En el destino: {p.destinoCarpetaRuta || "esperando la carpeta de recepción"}
              <br />
              Publicado por {p.publicadoPor ?? "sin dato"} el {fechaHora(p.publicado)}
              {p.revisado ? ` · revisado el ${fechaHora(p.revisado)}` : ""}
              {p.nota ? (
                <>
                  <br />
                  Nota: {p.nota}
                </>
              ) : null}
            </div>
            {p.archivos.length > 0 && (
              <details style={{ marginTop: 6 }} open={p.archivos.some((a) => a.estado === "diferencia" || a.estado === "error")}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>{textoConteo(p.archivos)}</summary>
                <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                  <tbody>
                    {p.archivos.map((a) => {
                      const ea = ESTADO_ARCHIVO[a.estado];
                      return (
                        <tr key={a.id}>
                          <td style={{ ...td, wordBreak: "break-word" }}>
                            {a.subcarpeta ? <span style={{ color: "var(--tc-gray-500)" }}>{a.subcarpeta}/</span> : null}
                            {a.nombre}
                            {(a.mensaje || avisos[a.id]) && <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 2 }}>{avisos[a.id] ?? a.mensaje}</div>}
                            {a.estado === "diferencia" && a.diferenciaVersionId && p.estado === "activa" && (
                              <button type="button" disabled={!!ocupado} onClick={() => reemplazar(p, a)} style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5, marginTop: 4 }}>
                                {ocupado === a.id ? "Reemplazando…" : "Reemplazar con la versión del origen"}
                              </button>
                            )}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <span style={etiqueta(ea.color, ea.fondo)}>{ea.texto}</span>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", color: "var(--tc-gray-500)" }} title="Versión en el origen → versión en el destino">
                            {versiones(a.origenRevision, a.destinoRevision)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
