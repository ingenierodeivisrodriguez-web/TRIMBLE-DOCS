"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import { ApiError } from "../../lib/propiedades/client";
import type { ManualesApi } from "../../lib/manuales/client";
import { etiquetaTipo } from "../../lib/manuales/tipos";
import type { BusquedaResponse, CarpetaResponse, ItemManual, ResultadoBusqueda } from "../../lib/manuales/types";
import Visor from "./Visor";

type Bloqueo = { code: "sin-acceso" | "sin-configurar" | "error"; texto: string };

function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function bloqueoDe(err: unknown): Bloqueo {
  if (err instanceof ApiError && (err.code === "sin-acceso" || err.code === "sin-configurar")) return { code: err.code, texto: err.message };
  return { code: "error", texto: err instanceof Error ? err.message : String(err) };
}

/**
 * The company's manuals, read from the folder of the manager project with the
 * user's own Trimble Connect permissions: browse folders, search, and read
 * the documents inline.
 */
export default function ManualesApp({ api }: { api: ManualesApi }) {
  const [carpeta, setCarpeta] = useState<CarpetaResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [bloqueo, setBloqueo] = useState<Bloqueo | null>(null);
  const [errorCarpeta, setErrorCarpeta] = useState("");
  const [query, setQuery] = useState("");
  const [busqueda, setBusqueda] = useState<{ q: string; r: BusquedaResponse | null; cargando: boolean; error: string } | null>(null);
  const [abierto, setAbierto] = useState<ItemManual | null>(null);
  const [angosto, setAngosto] = useState(false);

  useEffect(() => {
    const medir = () => setAngosto(window.innerWidth < 760);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const abrirCarpeta = useCallback(
    async (folderId: string | null, nombre?: string) => {
      setCargando(true);
      setErrorCarpeta("");
      try {
        setCarpeta(await api.carpeta(folderId));
        setBloqueo(null);
      } catch (err) {
        const b = bloqueoDe(err);
        // Without access to the library itself everything is blocked; a subfolder only blocks itself.
        if (!carpeta || b.code === "sin-configurar") setBloqueo(b);
        else setErrorCarpeta(b.code === "sin-acceso" ? `No tiene acceso a la carpeta «${nombre ?? "seleccionada"}».` : b.texto);
      } finally {
        setCargando(false);
      }
    },
    [api, carpeta]
  );

  useEffect(() => {
    abrirCarpeta(null);
    // Only on mount: later navigation calls abrirCarpeta directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function buscar(q: string) {
    const texto = q.trim();
    if (!texto) {
      setBusqueda(null);
      return;
    }
    setBusqueda({ q: texto, r: null, cargando: true, error: "" });
    // On a narrow screen the open document covers the list: show the results.
    if (angosto) setAbierto(null);
    try {
      const r = await api.buscar(texto);
      setBusqueda({ q: texto, r, cargando: false, error: "" });
    } catch (err) {
      setBusqueda({ q: texto, r: null, cargando: false, error: bloqueoDe(err).texto });
    }
  }

  if (bloqueo) return <Bloqueado bloqueo={bloqueo} onReintentar={() => abrirCarpeta(null)} />;
  if (!carpeta) return <div style={{ padding: 24, color: "var(--tc-gray-500)" }}>Abriendo los manuales...</div>;

  const b = carpeta.biblioteca;
  const lista = (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", background: "#fff", borderRight: angosto ? "none" : "1px solid #dfe4ea" }}>
      {busqueda ? (
        <>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", fontSize: 13.5, display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={enlace} onClick={() => setBusqueda(null)}>
              ← Carpetas
            </button>
            <span style={{ color: "var(--tc-gray-500)" }}>Resultados para «{busqueda.q}»</span>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {busqueda.cargando && <p style={nota}>Buscando en todas las carpetas...</p>}
            {busqueda.error && <p style={{ ...nota, color: "#8a1c14" }}>{busqueda.error}</p>}
            {busqueda.r && busqueda.r.resultados.length === 0 && <p style={nota}>No hay documentos con ese nombre.</p>}
            {busqueda.r?.resultados.map((it: ResultadoBusqueda) => (
              <Fila
                key={it.id}
                item={it}
                detalle={it.ruta || b.carpetaNombre}
                activo={abierto?.id === it.id}
                onClick={() => {
                  if (it.tipo === "carpeta") {
                    setBusqueda(null);
                    abrirCarpeta(it.id, it.nombre);
                  } else setAbierto(it);
                }}
              />
            ))}
            {busqueda.r && !busqueda.r.completa && <p style={nota}>Se muestran los primeros resultados; escribe más palabras para afinar.</p>}
          </div>
        </>
      ) : (
        <>
          <nav aria-label="Ruta" style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", fontSize: 13.5, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {carpeta.carpeta.ruta.map((r, i) => (
              <span key={r.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {i > 0 && <span style={{ color: "var(--tc-gray-500)" }}>›</span>}
                {i < carpeta.carpeta.ruta.length - 1 ? (
                  <button type="button" style={enlace} onClick={() => abrirCarpeta(r.id === b.carpetaId ? null : r.id, r.nombre)}>
                    {r.nombre}
                  </button>
                ) : (
                  <strong>{r.nombre}</strong>
                )}
              </span>
            ))}
          </nav>
          <div style={{ flex: 1, overflow: "auto", opacity: cargando ? 0.6 : 1 }}>
            {errorCarpeta && <p style={{ ...nota, color: "#8a1c14" }}>{errorCarpeta}</p>}
            {carpeta.items.length === 0 && !errorCarpeta && <p style={nota}>Esta carpeta está vacía.</p>}
            {carpeta.items.map((it) => (
              <Fila
                key={it.id}
                item={it}
                detalle={it.tipo === "carpeta" ? "" : [`v${it.version}`, formatBytes(it.tamano), fecha(it.modificado), it.modificadoPor].filter(Boolean).join(" · ")}
                activo={abierto?.id === it.id}
                onClick={() => (it.tipo === "carpeta" ? abrirCarpeta(it.id, it.nombre) : setAbierto(it))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontSize: 14 }}>
      <header style={{ background: "#2f55b0", color: "#fff", padding: "8px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 17 }}>Manuales</strong>
        <span style={{ fontSize: 12.5, opacity: 0.85, flex: 1, minWidth: 180 }}>
          {b.projectName} › {b.carpetaNombre} · solo lectura
        </span>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            buscar(query);
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) setBusqueda(null);
            }}
            placeholder="Buscar manual por nombre"
            aria-label="Buscar manual"
            style={{ border: "none", borderRadius: 4, padding: "6px 10px", fontSize: 13.5, width: 240, fontFamily: "inherit" }}
          />
          <button type="submit" style={{ ...botonCabecera }}>
            Buscar
          </button>
        </form>
        <button type="button" style={botonCabecera} onClick={() => abrirCarpeta(carpeta.carpeta.id === b.carpetaId ? null : carpeta.carpeta.id)} title="Volver a cargar la carpeta">
          ↻
        </button>
      </header>

      {angosto ? (
        <div style={{ flex: 1, minHeight: 0 }}>{abierto ? <Visor api={api} item={abierto} onCerrar={() => setAbierto(null)} /> : lista}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr" }}>
          {lista}
          {abierto ? (
            <Visor api={api} item={abierto} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tc-gray-500)", background: "#eef1f5", padding: 24, textAlign: "center" }}>
              Elige un documento de la lista para leerlo aquí.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fila({ item, detalle, activo, onClick }: { item: ItemManual; detalle: string; activo: boolean; onClick: () => void }) {
  const tipo = etiquetaTipo(item.ext);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        gap: 10,
        width: "100%",
        alignItems: "center",
        padding: "8px 12px",
        border: "none",
        borderBottom: "1px solid #eef1f5",
        background: activo ? "#dbe8fb" : "#fff",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      {item.tipo === "carpeta" ? (
        <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M1 4a2 2 0 0 1 2-2h6l2.5 3H23a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" fill="#f2b33d" />
          <path d="M1 8h24v11a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" fill="#f7c95c" />
        </svg>
      ) : (
        <span style={{ flexShrink: 0, width: 34, height: 22, borderRadius: 3, background: tipo.color, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {tipo.label}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, color: "var(--tc-gray-700)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.nombre}>
          {item.nombre}
        </span>
        {detalle && <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detalle}</span>}
      </span>
      {item.tipo === "carpeta" && <span style={{ color: "var(--tc-gray-500)" }}>›</span>}
    </button>
  );
}

/** "No tiene acceso" (or not configured yet): the whole tool is blocked. */
function Bloqueado({ bloqueo, onReintentar }: { bloqueo: Bloqueo; onReintentar: () => void }) {
  const titulo = bloqueo.code === "sin-acceso" ? "No tiene acceso" : bloqueo.code === "sin-configurar" ? "Manuales aún no está configurado" : "No se pudieron abrir los manuales";
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div role="alert" style={{ maxWidth: 460, textAlign: "center", background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(10,61,98,0.12)", padding: 28 }}>
        {bloqueo.code === "sin-acceso" && (
          <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" fill="#b3261e" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#b3261e" strokeWidth="2" />
          </svg>
        )}
        <h1 style={{ fontSize: 20, color: bloqueo.code === "sin-acceso" ? "#8a1c14" : "var(--tc-blue-900)", margin: "8px 0" }}>{titulo}</h1>
        <p style={{ color: "var(--tc-gray-500)", fontSize: 14, lineHeight: 1.5 }}>{bloqueo.texto.replace(/^No tiene acceso\.\s*/, "")}</p>
        <button type="button" onClick={onReintentar} style={{ ...botonCabecera, background: "var(--tc-blue-600)", border: "none", marginTop: 6 }}>
          Reintentar
        </button>
      </div>
    </div>
  );
}

const nota: CSSProperties = { padding: "10px 12px", margin: 0, fontSize: 13.5, color: "var(--tc-gray-500)" };
const enlace: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", padding: 0, cursor: "pointer", font: "inherit", textDecoration: "underline" };
const botonCabecera: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  borderRadius: 4,
  padding: "5px 10px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
