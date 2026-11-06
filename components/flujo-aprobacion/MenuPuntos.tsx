"use client";

import { useEffect, useRef, useState } from "react";
import { C } from "../presupuesto/ui";

export interface OpcionMenu {
  texto: string;
  onClick: () => void;
  peligro?: boolean;
  oculto?: boolean;
}

/** The "⋮" button with its list of actions (closes on a click elsewhere or Escape). */
export default function MenuPuntos({ opciones, titulo = "Más acciones" }: { opciones: OpcionMenu[]; titulo?: string }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  const visibles = opciones.filter((o) => !o.oculto);
  if (!visibles.length) return null;
  return (
    <div ref={caja} style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        title={titulo}
        aria-label={titulo}
        aria-expanded={abierto}
        style={{ border: "none", background: abierto ? "#e8edf3" : "transparent", borderRadius: 4, width: 30, height: 30, cursor: "pointer", fontSize: 18, lineHeight: 1, color: "var(--tc-gray-700)" }}
      >
        ⋮
      </button>
      {abierto && (
        <div role="menu" style={{ position: "absolute", right: 0, top: 32, zIndex: 30, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 6px 18px rgba(20,40,70,.16)", minWidth: 220, padding: "4px 0" }}>
          {visibles.map((o) => (
            <button
              key={o.texto}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                o.onClick();
              }}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "7px 14px", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", color: o.peligro ? "#a1261b" : "var(--tc-gray-700)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f4f8")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {o.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
