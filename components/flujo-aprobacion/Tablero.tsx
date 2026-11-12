"use client";

import type { CSSProperties } from "react";
import type { ResumenTablero, Tarjeta } from "../../lib/flujo-aprobacion/lista";
import { C } from "../presupuesto/ui";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Four dashboard cards above the list (the owner's wish, 11-11-2026): how many
 * flows, and how many are por revisar, por aprobar and aprobados (as the
 * Estado column says), each with its files. Since 12-11-2026 a click shows the
 * caller's flows in that state (files waiting for their review or approval;
 * approved ones where they took part), and each card says how many those are;
 * another click on it, or on «Flujos», shows all.
 */
export default function Tablero({ resumen, tarjeta, onTarjeta }: { resumen: ResumenTablero; tarjeta: Tarjeta | ""; onTarjeta: (t: Tarjeta | "") => void }) {
  const desactivados = resumen.flujos - resumen.activos;
  const tuyos = (n: number, toca: boolean) => (n ? (toca ? `${n} te ${n === 1 ? "toca" : "tocan"}` : `${n} con tu participación`) : "");
  const tarjetas: { clave: Tarjeta | ""; titulo: string; valor: number; detalle: string; mios: string; color: string; ayuda: string }[] = [
    {
      clave: "",
      titulo: "Flujos",
      valor: resumen.flujos,
      detalle: `${plural(resumen.activos, "activo", "activos")}${desactivados ? ` · ${plural(desactivados, "desactivado", "desactivados")}` : ""}`,
      mios: "",
      color: "#2f4f8f",
      ayuda: "Ver todos los flujos",
    },
    {
      clave: "por-revisar",
      titulo: "Por revisar",
      valor: resumen.porRevisar.flujos,
      detalle: plural(resumen.porRevisar.archivos, "archivo esperando revisión", "archivos esperando revisión"),
      mios: tuyos(resumen.mios.porRevisar, true),
      color: "#8a96a8",
      ayuda: "Ver los flujos con archivos que esperan tu revisión (eres responsable del paso que espera)",
    },
    {
      clave: "por-aprobar",
      titulo: "Por aprobar",
      valor: resumen.porAprobar.flujos,
      detalle: plural(resumen.porAprobar.archivos, "archivo esperando aprobación", "archivos esperando aprobación"),
      mios: tuyos(resumen.mios.porAprobar, true),
      color: "#8a96a8",
      ayuda: "Ver los flujos con archivos que esperan tu aprobación (eres responsable del último paso)",
    },
    {
      clave: "aprobado",
      titulo: "Aprobados",
      valor: resumen.aprobados.flujos,
      detalle: plural(resumen.aprobados.archivos, "archivo aprobado", "archivos aprobados"),
      mios: tuyos(resumen.mios.aprobados, false),
      color: "#3c8a3c",
      ayuda: "Ver los flujos aprobados donde fuiste responsable o decidiste",
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, maxWidth: 1100 }}>
      {tarjetas.map((t) => {
        const activa = t.clave === "" ? !tarjeta : tarjeta === t.clave;
        // Separate sides (not \`border\` + \`borderLeft\`): React warns when both change on a click.
        const lado = `1px solid ${activa ? t.color : C.border}`;
        const caja: CSSProperties = {
          textAlign: "left",
          background: "#fff",
          borderTop: lado,
          borderRight: lado,
          borderBottom: lado,
          borderLeft: `4px solid ${t.color}`,
          borderRadius: 6,
          padding: "12px 16px",
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: activa ? "0 2px 8px rgba(20,40,70,.12)" : "0 1px 2px rgba(20,40,70,.05)",
        };
        return (
          <button key={t.titulo} type="button" style={caja} aria-pressed={activa} title={t.ayuda} onClick={() => onTarjeta(t.clave && tarjeta === t.clave ? "" : t.clave)}>
            <div style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{t.titulo}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "var(--tc-gray-800)", lineHeight: 1.15, margin: "2px 0" }}>{t.valor}</div>
            <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{t.detalle}</div>
            {t.mios && <div style={{ fontSize: 12.5, color: "#2f4f8f", fontWeight: 600, marginTop: 3 }}>{t.mios}</div>}
          </button>
        );
      })}
    </div>
  );
}
