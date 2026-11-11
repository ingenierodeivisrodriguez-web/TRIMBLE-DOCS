"use client";

import { CSSProperties, useEffect, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { CarpetaInfo } from "../../lib/publicar/types";
import { message, Notice } from "../presupuesto/ui";

export interface ArchivoParaFlujo {
  id: string;
  nombre: string;
  /** "Proyecto / Planos / Estructura / plano.pdf", as the flow keeps it. */
  ruta: string;
}

const AZUL = "#2f4f8f";
const fila: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "0 14px", minHeight: 46, borderBottom: "1px solid #eef1f4", fontSize: 15, color: "var(--tc-gray-800)" };
const botonTexto: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-gray-700)", fontSize: 15, padding: "9px 14px", cursor: "pointer", fontFamily: "inherit" };

function IconoCarpeta() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M1 3a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" fill="#5f6b7a" />
    </svg>
  );
}

function IconoArchivo() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M2 0h8l6 6v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" fill="#3d4652" />
      <path d="M10 0v6h6" fill="#8d97a5" />
    </svg>
  );
}

function Flecha() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" style={{ flex: "none", marginLeft: "auto" }}>
      <path d="M2 2l6 6-6 6" fill="none" stroke="#3d4652" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Picking the flow's files in a floating box like Trimble's "Añadir
 * referencias": folders open on click, files are checked (several, from
 * different folders: the marks stay while moving between folders). The
 * files already in the flow show checked and can't be picked again. Nothing
 * changes in the form until "Añadir archivos".
 */
export default function ElegirArchivos({
  api,
  projectId,
  yaElegidos,
  maximo,
  onAnadir,
  onCancelar,
}: {
  api: Pick<FlujoApi, "carpeta">;
  projectId: string;
  /** Ids of the files already in the flow. */
  yaElegidos: string[];
  /** How many more files fit in the flow. */
  maximo: number;
  onAnadir: (archivos: ArchivoParaFlujo[]) => void;
  onCancelar: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [info, setInfo] = useState<CarpetaInfo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [marcados, setMarcados] = useState<ArchivoParaFlujo[]>([]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    api
      .carpeta(projectId, folderId)
      .then((r) => vigente && setInfo(r))
      .catch((err) => vigente && setError(message(err)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [api, projectId, folderId]);

  // Escape closes only this box (the flow's form stays open).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCancelar]);

  const rutaCarpeta = info ? info.carpeta.ruta.map((r) => r.nombre).join(" / ") : "";
  const archivoDe = (id: string, nombre: string): ArchivoParaFlujo => ({ id, nombre, ruta: `${rutaCarpeta} / ${nombre}` });
  const libres = info ? info.items.filter((it) => it.tipo === "archivo" && !yaElegidos.includes(it.id)) : [];
  const todosAqui = libres.length > 0 && libres.every((it) => marcados.some((m) => m.id === it.id));
  const pasado = marcados.length > maximo;

  function alternar(id: string, nombre: string) {
    setMarcados((ms) => (ms.some((m) => m.id === id) ? ms.filter((m) => m.id !== id) : [...ms, archivoDe(id, nombre)]));
  }
  function marcarTodos() {
    setMarcados((ms) => (todosAqui ? ms.filter((m) => !libres.some((it) => it.id === m.id)) : [...ms, ...libres.filter((it) => !ms.some((m) => m.id === it.id)).map((it) => archivoDe(it.id, it.nombre))]));
  }

  // The project's name stands for its root folder, as in Trimble.
  const migas = info ? info.carpeta.ruta.map((r, i) => ({ id: r.id, nombre: i === 0 ? info.proyecto.nombre || r.nombre : r.nombre })) : [];

  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(20,30,45,0.3)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="elegir-archivos-titulo"
        style={{ width: 520, maxWidth: "100%", height: 640, maxHeight: "100%", background: "#f7f8fa", borderRadius: 4, boxShadow: "0 16px 48px rgba(0,0,0,0.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "22px 26px 12px", flexShrink: 0 }}>
          <h2 id="elegir-archivos-titulo" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--tc-gray-800)" }}>
            Añadir archivos
          </h2>
          <button type="button" onClick={onCancelar} aria-label="Cerrar" title="Cerrar" style={{ border: "none", background: "transparent", fontSize: 22, lineHeight: 1, color: "var(--tc-gray-700)", cursor: "pointer", padding: 4 }}>
            ✕
          </button>
        </header>

        <div style={{ padding: "0 26px", flexShrink: 0 }}>
          <div style={{ borderTop: "1px solid #dfe4ea", paddingTop: 12, fontSize: 13, color: "var(--tc-gray-500)" }}>Puede seleccionar más de un archivo a la vez.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "10px 0 8px", fontSize: 15, color: "var(--tc-gray-800)", minHeight: 24 }}>
            {migas.length > 1 && (
              <button type="button" onClick={() => setFolderId(migas[migas.length - 2].id)} aria-label="Volver a la carpeta anterior" title="Volver" style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 6px 0 0", fontSize: 18, lineHeight: 1, color: "var(--tc-gray-700)" }}>
                ‹
              </button>
            )}
            {migas.map((m, i) => (
              <span key={m.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {i > 0 && <span style={{ color: "var(--tc-gray-400)" }}>/</span>}
                {i < migas.length - 1 ? (
                  <button type="button" onClick={() => setFolderId(m.id)} style={{ border: "none", background: "transparent", color: AZUL, cursor: "pointer", padding: 0, font: "inherit" }}>
                    {m.nombre}
                  </button>
                ) : (
                  <span>{m.nombre}</span>
                )}
              </span>
            ))}
            {!cargando && libres.length > 1 && (
              <button type="button" onClick={marcarTodos} style={{ border: "none", background: "transparent", color: AZUL, cursor: "pointer", padding: 0, fontSize: 13, marginLeft: "auto", fontFamily: "inherit" }}>
                {todosAqui ? "Quitar todos" : "Marcar todos"}
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", margin: "0 26px", background: "#fff", border: "1px solid #e6e9ee" }}>
          {error ? (
            <Notice kind="error" style={{ margin: 12 }}>
              {error}
            </Notice>
          ) : cargando && !info ? (
            <div style={{ ...fila, color: "var(--tc-gray-500)", borderBottom: "none" }}>Cargando…</div>
          ) : info && info.items.length === 0 ? (
            <div style={{ ...fila, color: "var(--tc-gray-500)", borderBottom: "none" }}>Carpeta vacía.</div>
          ) : (
            <div style={{ opacity: cargando ? 0.5 : 1 }}>
              {info?.items.map((it) => {
                if (it.tipo === "carpeta") {
                  return (
                    <button key={it.id} type="button" onClick={() => setFolderId(it.id)} title="Abrir la carpeta" style={{ ...fila, width: "100%", border: "none", borderBottom: fila.borderBottom, background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                      <IconoCarpeta />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nombre}</span>
                      <Flecha />
                    </button>
                  );
                }
                const ya = yaElegidos.includes(it.id);
                const marcado = ya || marcados.some((m) => m.id === it.id);
                return (
                  <label key={it.id} title={ya ? "Ya está en el flujo" : undefined} style={{ ...fila, cursor: ya ? "default" : "pointer", color: ya ? "var(--tc-gray-500)" : fila.color }}>
                    <input type="checkbox" checked={marcado} disabled={ya} onChange={() => alternar(it.id, it.nombre)} aria-label={`Elegir ${it.nombre}`} style={{ width: 18, height: 18, margin: 0, accentColor: AZUL, flex: "none" }} />
                    <IconoArchivo />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nombre}</span>
                    {it.revision !== null && <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--tc-gray-500)", flex: "none" }}>v{it.revision}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <footer style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 26px 18px", marginTop: 14, borderTop: "1px solid #dfe4ea", flexShrink: 0 }}>
          {marcados.length > 0 && (
            <span style={{ fontSize: 13.5, color: pasado ? "#b3261e" : "var(--tc-gray-500)", marginRight: "auto" }}>
              {pasado ? `Caben ${maximo} archivos más en este flujo: quita ${marcados.length - maximo}.` : `${marcados.length} ${marcados.length === 1 ? "archivo marcado" : "archivos marcados"}`}
            </span>
          )}
          <button type="button" onClick={onCancelar} style={botonTexto}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onAnadir(marcados)}
            disabled={!marcados.length || pasado}
            style={{ border: "none", background: AZUL, color: "#fff", borderRadius: 3, padding: "10px 22px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: !marcados.length || pasado ? "default" : "pointer", opacity: !marcados.length || pasado ? 0.5 : 1 }}
          >
            Añadir archivos
          </button>
        </footer>
      </div>
    </div>
  );
}
