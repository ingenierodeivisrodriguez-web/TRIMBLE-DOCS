"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { redondear } from "../../lib/presupuesto/calc";
import { fmt } from "../../lib/presupuesto/format";
import { porUbicacion } from "../../lib/presupuesto/memoria";
import type { ColumnaMemoria, ElementoVinculado } from "../../lib/presupuesto/types";
import { C, message } from "./ui";

const HEAD = 36;
const THEAD = 30;
const ROWH = 28;
const FOOT = 40;
const VISIBLES = 12;

/** Height of the open list (fixed, so the budget's rows can be laid out around it). */
export function alturaMemoria(elementos: number): number {
  return HEAD + THEAD + Math.min(Math.max(elementos, 2), VISIBLES) * ROWH + FOOT + 10;
}

/**
 * The "memoria de cantidades" of a partida, open inside the budget between its
 * rows: each linked element with the columns the user chose, its quantity, the
 * partida's unit price and the resulting value.
 */
export default function MemoriaCantidad({
  itemId,
  titulo,
  unidad,
  columnas,
  cu,
  metrado,
  metradoModelo,
  load,
  onClose,
}: {
  itemId: string;
  titulo: string;
  unidad: string;
  columnas: ColumnaMemoria[];
  /** The partida's unit cost: each element's value is its quantity times this. */
  cu: number;
  /** The quantity the partida uses in the budget. */
  metrado: number;
  /** Whether that quantity comes from these elements (3D) or was typed. */
  metradoModelo: boolean;
  load: (itemId: string) => Promise<ElementoVinculado[]>;
  onClose: () => void;
}) {
  const [elementos, setElementos] = useState<ElementoVinculado[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setElementos(null);
    setError("");
    load(itemId).then(
      (list) => !cancelled && setElementos(list),
      (err) => !cancelled && setError(message(err))
    );
    return () => {
      cancelled = true;
    };
  }, [itemId, load]);

  const filas = useMemo(() => porUbicacion(elementos ?? [], columnas), [elementos, columnas]);
  const cantidadTotal = filas.reduce((sum, e) => sum + (e.cantidad ?? 0), 0);
  const valorTotal = filas.reduce((sum, e) => sum + redondear((e.cantidad ?? 0) * cu, 2), 0);
  const sinDatos = filas.filter((e) => !e.memoria || !columnas.some((c) => c.fuente !== "ifcguid" && e.memoria?.[c.id])).length;
  const difiere = filas.length > 0 && Math.abs(cantidadTotal - metrado) > 0.005;
  const columnasConDatos = columnas.length;
  const vacias = Math.max(0, columnasConDatos);

  const nota = difiere
    ? `La suma de los elementos (${fmt(cantidadTotal)}) difiere del metrado de la partida (${fmt(metrado)}${metradoModelo ? "" : ", manual"}).`
    : sinDatos > 0
      ? `${sinDatos} elemento(s) sin datos en estas columnas.`
      : "";

  return (
    <div style={{ height: alturaMemoria(Math.max(elementos?.length ?? 0, 0)), padding: "4px 8px 6px 70px", boxSizing: "border-box", background: "#f2f5fa" }}>
      <div role="region" aria-label={`Memoria de cantidades de ${titulo}`} style={box} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ height: HEAD, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", background: "#e4ebf5", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <strong style={{ fontSize: 13.5 }}>Memoria de cantidades</strong>
          <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {titulo} · PU {fmt(cu)}
            {unidad ? ` / ${unidad}` : ""}
          </span>
          <button type="button" onClick={onClose} aria-label="Cerrar la memoria" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, fontFamily: "inherit" }}>
            ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 44 }} />
              {columnas.map((c) => (
                <col key={c.id} />
              ))}
              <col style={{ width: 118 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: 138 }} />
            </colgroup>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "#f3f4f6", height: THEAD }}>
                <th style={th}>#</th>
                {columnas.map((c) => (
                  <th key={c.id} style={th} title={c.fuente === "propiedad" ? "Atributo de Propiedades" : c.fuente === "ifcguid" ? "IFCGUID del elemento" : "Propiedad del modelo"}>
                    {c.label}
                  </th>
                ))}
                <th style={th}>Cantidad{unidad ? ` (${unidad})` : ""}</th>
                <th style={th}>PU</th>
                <th style={th}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((e, i) => (
                <tr key={e.ifcGuid} style={{ height: ROWH }}>
                  <td style={{ ...td, textAlign: "right", color: "var(--tc-gray-500)" }}>{i + 1}</td>
                  {columnas.map((c) => {
                    const v = c.fuente === "ifcguid" ? e.ifcGuid : e.memoria?.[c.id];
                    return (
                      <td key={c.id} style={{ ...td, ...ellipsis }} title={v || undefined}>
                        {v || <span style={{ color: "#b8bec7" }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={tdNum}>{e.cantidad === null ? "—" : fmt(e.cantidad)}</td>
                  <td style={tdNum}>{fmt(cu)}</td>
                  <td style={{ ...tdNum, fontWeight: 600 }}>{e.cantidad === null ? "—" : fmt(redondear(e.cantidad * cu, 2))}</td>
                </tr>
              ))}
              {elementos === null && !error && (
                <tr>
                  <td colSpan={vacias + 4} style={{ ...td, color: "var(--tc-gray-500)", padding: 12 }}>
                    Cargando...
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={vacias + 4} style={{ ...td, color: "#8a1c14", padding: 12 }}>
                    {error}
                  </td>
                </tr>
              )}
              {elementos && filas.length === 0 && (
                <tr>
                  <td colSpan={vacias + 4} style={{ ...td, color: "var(--tc-gray-500)", padding: 12 }}>
                    Esta partida no tiene elementos asociados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ height: FOOT, display: "flex", alignItems: "center", gap: 12, padding: "0 10px", borderTop: `1px solid ${C.border}`, background: "#fafbfc", flexShrink: 0, fontSize: 13 }}>
          <strong>Total · {filas.length.toLocaleString("es")} elemento(s)</strong>
          {nota && <span style={{ color: "#7a5300", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nota}>{nota}</span>}
          {!nota && <span style={{ flex: 1 }} />}
          <strong style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(cantidadTotal)}
            {unidad ? ` ${unidad}` : ""}
          </strong>
          <strong style={{ fontVariantNumeric: "tabular-nums", minWidth: 120, textAlign: "right" }}>{fmt(redondear(valorTotal, 2))}</strong>
        </div>
      </div>
    </div>
  );
}

const box: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "#fff",
  border: "1px solid #aebbd3",
  borderLeft: "4px solid var(--tc-blue-600)",
  boxSizing: "border-box",
  overflow: "hidden",
};
const th: CSSProperties = { padding: "5px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6" };
const td: CSSProperties = { padding: "3px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
