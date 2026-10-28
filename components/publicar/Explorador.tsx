"use client";

import { useEffect, useState } from "react";
import { fecha } from "../../lib/compras/formato";
import { formatBytes } from "../../lib/format";
import type { PublicarApi } from "../../lib/publicar/client";
import type { CarpetaInfo, ItemCarpeta } from "../../lib/publicar/types";
import { acceptButton, C, message, Notice } from "../presupuesto/ui";
import { linkBtn, td } from "../compras/estilos";

export interface Elegido {
  id: string;
  nombre: string;
  /** "Proyecto / Planos / Estructura". */
  ruta: string;
  tamano: number | null;
  revision: number | null;
}

function Icono({ tipo }: { tipo: ItemCarpeta["tipo"] }) {
  return tipo === "carpeta" ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#b8862a" strokeWidth="1" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M3.5 1.5h6l3 3v10h-9z" fill="#fff" stroke="#8a96a8" strokeWidth="1" />
      <path d="M9.5 1.5v3h3" fill="none" stroke="#8a96a8" strokeWidth="1" />
    </svg>
  );
}

/**
 * The folders of a project, as the user's Trimble permissions show them.
 * `elegir: "archivo"` checks and unchecks files, from any folder (folders
 * open on click); `"carpeta"` picks the open folder with "Usar esta
 * carpeta" (files are listed, not pickable). `recarga` reloads the open
 * folder when it changes.
 */
export default function Explorador({
  api,
  proyecto,
  elegir,
  seleccionados,
  onElegir,
  recarga = 0,
}: {
  api: PublicarApi;
  proyecto: string;
  elegir: "archivo" | "carpeta";
  seleccionados: string[];
  onElegir: (e: Elegido) => void;
  recarga?: number;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [info, setInfo] = useState<CarpetaInfo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    api
      .carpeta(proyecto, folderId)
      .then((r) => vigente && setInfo(r))
      .catch((err) => vigente && setError(message(err)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [api, proyecto, folderId, recarga]);

  const ruta = info ? info.carpeta.ruta.map((r) => r.nombre).join(" / ") : "";
  const soloLectura = info?.carpeta.permiso === "READ";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4 }}>
      <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, background: "#f6f8fb", fontSize: 13.5, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {info?.carpeta.ruta.map((r, i) => (
          <span key={r.id} style={{ display: "inline-flex", gap: 4 }}>
            {i > 0 && <span style={{ color: "var(--tc-gray-500)" }}>/</span>}
            {i < info.carpeta.ruta.length - 1 ? (
              <button type="button" style={linkBtn} onClick={() => setFolderId(r.id)}>
                {r.nombre}
              </button>
            ) : (
              <strong>{r.nombre}</strong>
            )}
          </span>
        ))}
        {cargando && <span style={{ color: "var(--tc-gray-500)", marginLeft: 8 }}>Cargando…</span>}
      </div>
      {error ? (
        <Notice kind="error" style={{ margin: 10 }}>
          {error}
        </Notice>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {info && info.items.length === 0 && !cargando && (
                <tr>
                  <td style={{ ...td, color: "var(--tc-gray-500)" }}>Carpeta vacía.</td>
                </tr>
              )}
              {info?.items.map((it) => {
                const esArchivo = it.tipo === "archivo";
                const activo = esArchivo && elegir === "archivo";
                const marcado = activo && seleccionados.includes(it.id);
                const abrir = () => {
                  if (!esArchivo) setFolderId(it.id);
                  else if (activo) onElegir({ id: it.id, nombre: it.nombre, ruta: `${ruta} / ${it.nombre}`, tamano: it.tamano, revision: it.revision });
                };
                return (
                  <tr
                    key={it.id}
                    onClick={abrir}
                    style={{ cursor: esArchivo && !activo ? "default" : "pointer", background: marcado ? C.rowSelected : undefined, color: esArchivo && !activo ? "var(--tc-gray-500)" : undefined }}
                    title={esArchivo ? (activo ? (marcado ? "Quitar este archivo" : "Elegir este archivo") : "En este paso se elige una carpeta") : "Abrir la carpeta"}
                  >
                    {elegir === "archivo" && (
                      <td style={{ ...td, width: 24, paddingRight: 0 }}>
                        {esArchivo && <input type="checkbox" checked={marcado} readOnly tabIndex={-1} aria-label={`Elegir ${it.nombre}`} style={{ margin: 0, pointerEvents: "none" }} />}
                      </td>
                    )}
                    <td style={{ ...td, width: "100%" }}>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <Icono tipo={it.tipo} />
                        {it.nombre}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "var(--tc-gray-500)" }}>{it.revision !== null ? `v${it.revision}` : ""}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "var(--tc-gray-500)", textAlign: "right" }}>{it.tamano !== null ? formatBytes(it.tamano) : ""}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "var(--tc-gray-500)" }}>{it.modificado ? fecha(it.modificado.slice(0, 10)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {elegir === "carpeta" && info && (
        <div style={{ padding: "8px 10px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={soloLectura}
            onClick={() => onElegir({ id: info.carpeta.id, nombre: info.carpeta.nombre, ruta, tamano: null, revision: null })}
            style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, opacity: soloLectura ? 0.5 : 1, cursor: soloLectura ? "not-allowed" : "pointer" }}
          >
            {seleccionados.includes(info.carpeta.id) ? "Carpeta elegida" : "Usar esta carpeta"}
          </button>
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
            {soloLectura ? "Solo tienes lectura en esta carpeta: abre otra donde puedas subir archivos." : `Abierta: ${info.carpeta.nombre}`}
          </span>
        </div>
      )}
    </div>
  );
}
