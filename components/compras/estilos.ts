import type { CSSProperties } from "react";
import { acceptButton, C } from "../presupuesto/ui";

/** Styles shared by the Compras screens (on top of the budget tool's tokens). */
export const card: CSSProperties = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "16px 20px", maxWidth: 900 };
export const titulo: CSSProperties = { margin: "0 0 8px", fontSize: 16, color: "var(--tc-blue-800)" };
export const texto: CSSProperties = { margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "var(--tc-gray-700)" };
export const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" };
export const botonSecundario: CSSProperties = { ...acceptButton, background: "#fff", color: "var(--tc-gray-700)", border: `1px solid ${C.border}` };
export const botonPeligro: CSSProperties = { ...acceptButton, background: C.close };
export const th: CSSProperties = { textAlign: "left", padding: "7px 8px", fontWeight: 600, fontSize: 12.5, color: "var(--tc-gray-500)", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: "#fff", position: "sticky", top: 0 };
export const td: CSSProperties = { padding: "7px 8px", fontSize: 13.5, borderBottom: `1px solid ${C.grid}`, verticalAlign: "top" };
export const select: CSSProperties = { border: "1px solid var(--tc-gray-300)", borderRadius: 4, padding: "5px 8px", fontSize: 13.5, fontFamily: "inherit", background: "#fff" };

export function etiqueta(color: string, fondo: string): CSSProperties {
  return { display: "inline-block", color, background: fondo, borderRadius: 10, padding: "1px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
}
export const subtitulo: CSSProperties = { margin: "8px 0 4px", fontSize: 14, fontWeight: 600, color: "var(--tc-blue-800)" };
