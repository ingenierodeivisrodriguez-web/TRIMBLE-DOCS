"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { fmt } from "../../lib/presupuesto/format";
import { MEMORIA_CAMPOS, porUbicacion } from "../../lib/presupuesto/memoria";
import type { ElementoVinculado } from "../../lib/presupuesto/types";
import { C, message } from "./ui";

/**
 * The "memoria de cantidades" of a partida: its model elements with where each
 * one is (bloque, conjunto, zona, nombre de zona, espacio) and its quantity.
 */
export default function MemoriaCantidad({
  itemId,
  titulo,
  unidad,
  load,
  onClose,
}: {
  itemId: string;
  titulo: string;
  unidad: string;
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

  const filas = useMemo(() => porUbicacion(elementos ?? []), [elementos]);
  const total = filas.reduce((sum, e) => sum + (e.cantidad ?? 0), 0);
  const sinUbicacion = filas.filter((e) => !e.memoria).length;

  return (
    <div role="region" aria-label={`Memoria de cantidades de ${titulo}`} style={box} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#eef2f7", borderBottom: `1px solid ${C.border}` }}>
        <strong style={{ fontSize: 13.5 }}>Memoria de cantidades</strong>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</span>
        <button type="button" onClick={onClose} aria-label="Cerrar la memoria" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, fontFamily: "inherit" }}>
          ✕
        </button>
      </div>
      <div style={{ maxHeight: 320, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#f3f4f6" }}>
              <th style={{ ...th, width: 46 }}>#</th>
              {MEMORIA_CAMPOS.map((c) => (
                <th key={c.key} style={th}>
                  {c.label}
                </th>
              ))}
              <th style={{ ...th, width: 110 }}>Cantidad{unidad ? ` (${unidad})` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((e, i) => (
              <tr key={e.ifcGuid}>
                <td style={{ ...td, textAlign: "right", color: "var(--tc-gray-500)" }}>{i + 1}</td>
                {MEMORIA_CAMPOS.map((c) => (
                  <td key={c.key} style={td}>
                    {e.memoria?.[c.key] || <span style={{ color: "#b8bec7" }}>—</span>}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.cantidad === null ? "—" : fmt(e.cantidad)}</td>
              </tr>
            ))}
            {elementos === null && !error && (
              <tr>
                <td colSpan={7} style={{ ...td, color: "var(--tc-gray-500)", padding: 12 }}>
                  Cargando...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={7} style={{ ...td, color: "#8a1c14", padding: 12 }}>
                  {error}
                </td>
              </tr>
            )}
            {elementos && filas.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, color: "var(--tc-gray-500)", padding: 12 }}>
                  Esta partida no tiene elementos asociados.
                </td>
              </tr>
            )}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr style={{ background: "#fafbfc", fontWeight: 700 }}>
                <td style={td} colSpan={6}>
                  Total · {filas.length.toLocaleString("es")} elemento(s)
                </td>
                <td style={{ ...td, textAlign: "right" }}>{fmt(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {sinUbicacion > 0 && (
        <div style={{ padding: "5px 10px", fontSize: 12, color: "#7a5300", background: "#fff6e0" }}>
          {sinUbicacion} elemento(s) no tienen Bloque, Conjunto, Zona, Nombre de zona ni Espacio en el modelo.
        </div>
      )}
    </div>
  );
}

const box: CSSProperties = {
  background: "#fff",
  border: "1px solid #8899b3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
  width: "min(820px, calc(100% - 80px))",
};
const th: CSSProperties = { padding: "7px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center" };
const td: CSSProperties = { padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
