"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { formatBytes } from "../../lib/format";
import { ApiError } from "../../lib/propiedades/client";
import type { ManualesApi } from "../../lib/manuales/client";
import { vistaDe } from "../../lib/manuales/tipos";
import type { ArchivoResponse, ItemManual } from "../../lib/manuales/types";

const MAX_VISTA_BYTES = 100 * 1024 * 1024;
const MAX_TEXTO_BYTES = 2 * 1024 * 1024;

type Estado =
  | { fase: "cargando"; loaded: number; total: number | null }
  | { fase: "pdf"; url: string }
  | { fase: "imagen" | "video" | "audio"; url: string }
  | { fase: "texto"; texto: string }
  | { fase: "sin-vista"; motivo: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shows a manual inline when the browser can (PDF, images, video, text, or a PDF rendition), with links to open or download it. */
export default function Visor({ api, item, onCerrar }: { api: ManualesApi; item: ItemManual; onCerrar?: () => void }) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando", loaded: 0, total: null });
  const [info, setInfo] = useState<ArchivoResponse | null>(null);
  const [error, setError] = useState("");
  const blobUrl = useRef<string | null>(null);

  useEffect(() => {
    const control = new AbortController();
    let vivo = true;
    setEstado({ fase: "cargando", loaded: 0, total: item.tamano || null });
    setInfo(null);
    setError("");

    const mostrarBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      blobUrl.current = url;
      return url;
    };

    (async () => {
      const vista = vistaDe(item.ext);
      try {
        const a = await api.archivo(item.id);
        if (!vivo) return;
        setInfo(a);
        if (vista === "ninguna") {
          setEstado({ fase: "sin-vista", motivo: "Este tipo de archivo no se puede mostrar aquí." });
          return;
        }
        if (vista === "imagen" || vista === "video" || vista === "audio") {
          setEstado({ fase: vista, url: a.url });
          return;
        }
        if (item.tamano > (vista === "texto" ? MAX_TEXTO_BYTES : MAX_VISTA_BYTES)) {
          setEstado({ fase: "sin-vista", motivo: `El archivo pesa ${formatBytes(item.tamano)}: ábrelo en Trimble Connect o descárgalo.` });
          return;
        }
        const progreso = (loaded: number, total: number | null) => vivo && setEstado({ fase: "cargando", loaded, total });
        if (vista === "texto") {
          const blob = await api.contenido(item.id, false, progreso, control.signal);
          if (vivo) setEstado({ fase: "texto", texto: await blob.text() });
          return;
        }
        try {
          const blob = await api.contenido(item.id, vista === "convertir", progreso, control.signal);
          if (vivo) setEstado({ fase: "pdf", url: mostrarBlob(new Blob([blob], { type: "application/pdf" })) });
        } catch (err) {
          if (!vivo || control.signal.aborted) return;
          if (vista === "convertir" || (err instanceof ApiError && err.code === "sin-contenido")) {
            setEstado({
              fase: "sin-vista",
              motivo: vista === "convertir" ? "Trimble Connect no tiene una vista previa de este archivo." : "No se pudo traer el documento para mostrarlo aquí.",
            });
          } else throw err;
        }
      } catch (err) {
        if (!vivo || control.signal.aborted) return;
        setError(err instanceof ApiError && err.code === "sin-acceso" ? "No tiene acceso a este archivo." : message(err));
        setEstado({ fase: "sin-vista", motivo: "" });
      }
    })();

    return () => {
      vivo = false;
      control.abort();
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = null;
    };
  }, [api, item]);

  /** Downloads through a fresh storage link (they expire). */
  async function descargar() {
    const ventana = window.open("", "_blank");
    try {
      const a = await api.archivo(item.id);
      if (ventana) ventana.location.href = a.url;
      else window.location.href = a.url;
    } catch (err) {
      ventana?.close();
      setError(message(err));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #dfe4ea", flexWrap: "wrap" }}>
        {onCerrar && (
          <button type="button" onClick={onCerrar} style={botonSecundario}>
            ← Volver
          </button>
        )}
        <strong style={{ fontSize: 15, flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.nombre}>
          {item.nombre}
        </strong>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>v{item.version}</span>
        <a href={info?.enTrimble} target="_blank" rel="noreferrer" style={{ ...botonSecundario, pointerEvents: info ? "auto" : "none", opacity: info ? 1 : 0.5, textDecoration: "none" }}>
          Abrir en Trimble Connect
        </a>
        <button type="button" onClick={descargar} style={botonPrimario}>
          Descargar
        </button>
      </div>
      {error && <div style={{ padding: "8px 12px", fontSize: 13.5, background: "#fdecea", color: "#8a1c14" }}>{error}</div>}
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", justifyContent: "center", background: "#eef1f5" }}>
        {estado.fase === "cargando" && (
          <div style={{ alignSelf: "center", textAlign: "center", color: "var(--tc-gray-500)", fontSize: 14 }}>
            Cargando el documento...
            {estado.loaded > 0 && (
              <div style={{ marginTop: 8 }}>
                {formatBytes(estado.loaded)}
                {estado.total ? ` de ${formatBytes(estado.total)}` : ""}
                {estado.total ? (
                  <div style={{ width: 220, height: 6, background: "#d7dee6", borderRadius: 3, marginTop: 6 }}>
                    <div style={{ width: `${Math.min(100, (estado.loaded / estado.total) * 100)}%`, height: "100%", background: "var(--tc-blue-600)", borderRadius: 3 }} />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {estado.fase === "pdf" && <iframe src={estado.url} title={item.nombre} style={{ border: "none", width: "100%", height: "100%" }} />}
        {estado.fase === "imagen" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={estado.url} alt={item.nombre} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", alignSelf: "center" }} onError={() => setEstado({ fase: "sin-vista", motivo: "No se pudo mostrar la imagen." })} />
        )}
        {estado.fase === "video" && <video src={estado.url} controls style={{ maxWidth: "100%", maxHeight: "100%", alignSelf: "center" }} />}
        {estado.fase === "audio" && <audio src={estado.url} controls style={{ alignSelf: "center", width: "min(520px, 90%)" }} />}
        {estado.fase === "texto" && (
          <pre style={{ margin: 0, padding: 16, width: "100%", overflow: "auto", background: "#fff", fontSize: 13, whiteSpace: "pre-wrap" }}>{estado.texto}</pre>
        )}
        {estado.fase === "sin-vista" && (
          <div style={{ alignSelf: "center", textAlign: "center", maxWidth: 420, padding: 20, color: "var(--tc-gray-700)", fontSize: 14, lineHeight: 1.5 }}>
            {estado.motivo && <p style={{ marginTop: 0 }}>{estado.motivo}</p>}
            {!error && <p style={{ marginBottom: 0 }}>Usa &quot;Abrir en Trimble Connect&quot; para verlo en el visor de Trimble, o &quot;Descargar&quot;.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const botonPrimario: CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "#fff",
  borderRadius: 5,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const botonSecundario: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
