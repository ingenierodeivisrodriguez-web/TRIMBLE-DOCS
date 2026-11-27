"use client";

// The date chooser of the full screen tab: a label on the photo that opens the list of the
// point's photos (thumbnail, date and inspector) to show another date. The button and the list
// are separate pieces because in the comparison the label lives in a layer cut by the bar,
// while the list must not be cut.

import { useEffect, useRef } from "react";
import type { OpcionFecha } from "../../lib/inspeccion-360/comparar";

/** The label that opens and closes the list; `estilo` places and colours it. */
export function BotonFecha({ texto, abierto, alPulsar, estilo, titulo }: { texto: string; abierto: boolean; alPulsar: () => void; estilo: React.CSSProperties; titulo: string }) {
  return (
    <button
      type="button"
      data-boton-fecha=""
      onClick={alPulsar}
      aria-haspopup="listbox"
      aria-expanded={abierto}
      title={titulo}
      style={{ border: "none", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, ...estilo, cursor: "pointer", pointerEvents: "auto" }}
    >
      {texto}
      <span aria-hidden="true" style={{ fontSize: "0.75em" }}>
        {abierto ? "▲" : "▼"}
      </span>
    </button>
  );
}

const CSS = ".i360-fecha:not(:disabled):hover{background:#eef2f6 !important}.i360-fecha:focus-visible{outline:2px solid #1565c0;outline-offset:-2px}";

/**
 * The list of dates. Closes with Escape, a click outside it or a choice; `motivoNo` says why a
 * date cannot be chosen (shown instead of the inspector).
 */
export function ListaFechas({
  opciones,
  elegida,
  titulo,
  motivoNo,
  alElegir,
  alCerrar,
  estilo,
}: {
  opciones: readonly OpcionFecha[];
  elegida: string;
  titulo: string;
  motivoNo?: (o: OpcionFecha) => string | null;
  alElegir: (id: string) => void;
  alCerrar: () => void;
  /** Where it opens (position inside the photo). */
  estilo: React.CSSProperties;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  useEffect(() => {
    const fuera = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      if (caja.current?.contains(t) || t?.closest?.("[data-boton-fecha]")) return;
      cerrar.current();
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cerrar.current();
    };
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", tecla);
    caja.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("pointerdown", fuera, true);
      document.removeEventListener("keydown", tecla);
    };
  }, []);

  return (
    <div
      ref={caja}
      role="listbox"
      aria-label={titulo}
      style={{
        position: "absolute",
        zIndex: 20,
        background: "#fff",
        borderRadius: 6,
        boxShadow: "0 4px 18px rgba(0,0,0,.5)",
        padding: 4,
        width: 280,
        maxWidth: "calc(100% - 16px)",
        maxHeight: "calc(100% - 64px)",
        overflowY: "auto",
        fontFamily: "system-ui, sans-serif",
        boxSizing: "border-box",
        ...estilo,
      }}
    >
      <style>{CSS}</style>
      <div style={{ fontSize: 11.5, color: "#555", padding: "3px 6px 5px", fontWeight: 600 }}>
        {titulo} · {opciones.length === 1 ? "1 foto" : `${opciones.length} fotos`}
      </div>
      {opciones.map((o) => {
        const actual = o.id === elegida;
        const no = actual ? null : (motivoNo?.(o) ?? null);
        return (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={actual}
            disabled={!!no}
            className="i360-fecha"
            onClick={() => {
              if (!actual) alElegir(o.id);
              alCerrar();
            }}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              width: "100%",
              border: "none",
              borderRadius: 4,
              background: actual ? "#fff3e0" : "transparent",
              padding: 4,
              cursor: no ? "not-allowed" : "pointer",
              opacity: no ? 0.45 : 1,
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            {o.miniatura ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.miniatura} alt="" style={{ width: 84, height: 42, objectFit: "cover", borderRadius: 3, flex: "none" }} />
            ) : (
              <span style={{ width: 84, height: 42, background: "#e4e7eb", borderRadius: 3, flex: "none" }} />
            )}
            <span style={{ fontSize: 12.5, color: "#222", minWidth: 0 }}>
              <b>{o.fecha}</b>
              {actual && <span style={{ color: "#EF6C00", fontWeight: 600 }}> · en pantalla</span>}
              {o.anulada && <span style={{ color: "#b3261e" }}> · anulada</span>}
              <span style={{ display: "block", color: no ? "#b3261e" : "#666", fontSize: 11.5 }}>{no ?? o.inspector}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
