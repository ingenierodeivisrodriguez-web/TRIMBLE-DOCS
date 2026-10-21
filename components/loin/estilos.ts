import type { CSSProperties } from "react";
import { acceptButton, baseInput, C } from "../presupuesto/ui";

/** Styles of the Requisitos BIM screens, on top of the budget tool's tokens. */
export const botonSecundario: CSSProperties = { ...acceptButton, background: "#fff", color: "var(--tc-gray-700)", border: `1px solid ${C.border}`, padding: "7px 14px", fontSize: 14 };
export const botonPrincipal: CSSProperties = { ...acceptButton, padding: "7px 14px", fontSize: 14 };
export const botonPeligro: CSSProperties = { ...botonPrincipal, background: C.close };
export const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" };
export const th: CSSProperties = {
  textAlign: "left",
  padding: "7px 8px",
  fontWeight: 600,
  fontSize: 12.5,
  color: "var(--tc-gray-500)",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  background: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 1,
};
export const td: CSSProperties = { padding: "6px 8px", fontSize: 13.5, borderBottom: `1px solid ${C.grid}`, verticalAlign: "top" };
export const select: CSSProperties = { ...baseInput, padding: "5px 6px" };
export const campo: CSSProperties = { ...baseInput, width: "100%", padding: "6px 8px", fontSize: 14 };
export const area: CSSProperties = { ...campo, minHeight: 70, resize: "vertical", lineHeight: 1.45 };
export const h3: CSSProperties = { margin: "0 0 6px", fontSize: 15.5, color: "var(--tc-blue-900)" };
export const parrafo: CSSProperties = { margin: "0 0 8px", fontSize: 14, lineHeight: 1.5 };
export const ayuda: CSSProperties = { margin: "4px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)", lineHeight: 1.45 };

export function etiqueta(color: string, fondo: string): CSSProperties {
  return { display: "inline-block", color, background: fondo, borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
}

export const ETIQUETA_NDI: Record<number, CSSProperties> = {
  1: etiqueta("#1f4f9c", "#e3edfb"),
  2: etiqueta("#7a4d00", "#fcefd6"),
  3: etiqueta("#5b2b8a", "#efe4fa"),
};

export const sugerida = etiqueta("#7a4d00", "#fcefd6");
export const inactivo = etiqueta("#6b7280", "#eceef1");
