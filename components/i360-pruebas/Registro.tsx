"use client";

// TEMPORARY (Inspección 360°, Fase 0): the on-screen log of the spikes, with a report the owner can
// copy and paste back. Remove when Fase 0 closes.

import { useCallback, useState } from "react";

export type EstadoLinea = "ok" | "falla" | "info";
export interface Linea {
  hora: string;
  prueba: string;
  estado: EstadoLinea;
  detalle: string;
}
export type Anotar = (prueba: string, estado: EstadoLinea, detalle: unknown) => void;

function texto(detalle: unknown): string {
  if (typeof detalle === "string") return detalle;
  if (detalle instanceof Error) return detalle.message;
  try {
    return JSON.stringify(detalle).slice(0, 3000);
  } catch {
    return String(detalle);
  }
}

export function useRegistro() {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const anotar = useCallback<Anotar>((prueba, estado, detalle) => {
    const hora = new Date().toLocaleTimeString("es-CO", { hour12: false });
    setLineas((l) => [...l, { hora, prueba, estado, detalle: texto(detalle) }]);
  }, []);
  const limpiar = useCallback(() => setLineas([]), []);
  return { lineas, anotar, limpiar };
}

/** Promise with a time limit: some viewer calls never answer when the feature is missing. */
export function conTiempo<T>(p: Promise<T>, ms = 10000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rechazar) => setTimeout(() => rechazar(new Error(`Sin respuesta en ${ms / 1000} s`)), ms)),
  ]);
}

const COLOR: Record<EstadoLinea, string> = { ok: "#2E7D32", falla: "#C62828", info: "#455A64" };

export function PanelRegistro({ titulo, lineas, limpiar }: { titulo: string; lineas: Linea[]; limpiar: () => void }) {
  const [copiado, setCopiado] = useState("");
  const informe = [`Informe ${titulo} — ${new Date().toLocaleString("es-CO", { hour12: false })}`, ...lineas.map((l) => `${l.hora} [${l.estado.toUpperCase()}] ${l.prueba}: ${l.detalle}`)].join("\n");
  async function copiar() {
    try {
      await navigator.clipboard.writeText(informe);
      setCopiado("Copiado.");
    } catch {
      setCopiado("El navegador no dejó copiar: seleccione el texto de abajo y cópielo a mano.");
    }
  }
  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Registro ({lineas.length})</strong>
        <button style={boton} onClick={copiar}>Copiar informe</button>
        <button style={boton} onClick={limpiar}>Limpiar</button>
        <span style={{ fontSize: 12, color: "#455A64" }}>{copiado}</span>
      </div>
      <ol style={{ fontSize: 12, paddingLeft: 18, maxHeight: 260, overflow: "auto", margin: "8px 0" }}>
        {lineas.map((l, i) => (
          <li key={i} style={{ marginBottom: 4, wordBreak: "break-word" }}>
            <span style={{ color: "#78909C" }}>{l.hora}</span> <b style={{ color: COLOR[l.estado] }}>{l.estado.toUpperCase()}</b> {l.prueba}: {l.detalle}
          </li>
        ))}
      </ol>
      <textarea readOnly value={informe} style={{ width: "100%", height: 90, fontSize: 11, fontFamily: "monospace" }} />
    </section>
  );
}

export const boton: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  border: "1px solid #90A4AE",
  borderRadius: 4,
  background: "#fff",
  cursor: "pointer",
};

export const bloque: React.CSSProperties = {
  border: "1px solid #CFD8DC",
  borderRadius: 6,
  padding: 10,
  marginTop: 10,
  fontSize: 13,
};
