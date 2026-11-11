"use client";

import type { CSSProperties } from "react";
import type { EstadoDocumento, ResumenTablero } from "../../lib/flujo-aprobacion/lista";
import { C } from "../presupuesto/ui";

type Elegible = Exclude<EstadoDocumento, "sin-archivos" | "rechazado">;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Four dashboard cards above the list (the owner's wish, 11-11-2026): how many
 * flows, and how many are por revisar, por aprobar and aprobados (as the
 * Estado column says), each with its files. A click shows only those flows in
 * the list (the Estado filter); another click on it, or on «Flujos», shows all.
 */
export default function Tablero({ resumen, estado, onEstado }: { resumen: ResumenTablero; estado: string; onEstado: (estado: Elegible | "") => void }) {
  const desactivados = resumen.flujos - resumen.activos;
  const tarjetas: { clave: Elegible | ""; titulo: string; valor: number; detalle: string; color: string; ayuda: string }[] = [
    {
      clave: "",
      titulo: "Flujos",
      valor: resumen.flujos,
      detalle: `${plural(resumen.activos, "activo", "activos")}${desactivados ? ` · ${plural(desactivados, "desactivado", "desactivados")}` : ""}`,
      color: "#2f4f8f",
      ayuda: "Ver todos los flujos",
    },
    {
      clave: "por-revisar",
      titulo: "Por revisar",
      valor: resumen.porRevisar.flujos,
      detalle: plural(resumen.porRevisar.archivos, "archivo esperando revisión", "archivos esperando revisión"),
      color: "#8a96a8",
      ayuda: "Ver solo los flujos con archivos en un paso de revisión",
    },
    {
      clave: "por-aprobar",
      titulo: "Por aprobar",
      valor: resumen.porAprobar.flujos,
      detalle: plural(resumen.porAprobar.archivos, "archivo esperando aprobación", "archivos esperando aprobación"),
      color: "#8a96a8",
      ayuda: "Ver solo los flujos con archivos en el último paso",
    },
    {
      clave: "aprobado",
      titulo: "Aprobados",
      valor: resumen.aprobados.flujos,
      detalle: plural(resumen.aprobados.archivos, "archivo aprobado", "archivos aprobados"),
      color: "#3c8a3c",
      ayuda: "Ver solo los flujos con todos sus archivos aprobados",
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, maxWidth: 1100 }}>
      {tarjetas.map((t) => {
        const activa = t.clave === "" ? !estado : estado === t.clave;
        const caja: CSSProperties = {
          textAlign: "left",
          background: "#fff",
          border: `1px solid ${activa ? t.color : C.border}`,
          borderLeft: `4px solid ${t.color}`,
          borderRadius: 6,
          padding: "12px 16px",
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: activa ? "0 2px 8px rgba(20,40,70,.12)" : "0 1px 2px rgba(20,40,70,.05)",
        };
        return (
          <button key={t.titulo} type="button" style={caja} aria-pressed={activa} title={t.ayuda} onClick={() => onEstado(t.clave && estado === t.clave ? "" : t.clave)}>
            <div style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{t.titulo}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "var(--tc-gray-800)", lineHeight: 1.15, margin: "2px 0" }}>{t.valor}</div>
            <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{t.detalle}</div>
          </button>
        );
      })}
    </div>
  );
}
