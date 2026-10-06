"use client";

import { CSSProperties, useMemo, useState } from "react";
import { calcularPie } from "../../lib/presupuesto/calc";
import { fmt } from "../../lib/presupuesto/format";
import { FilaPie, PresupuestoDoc } from "../../lib/presupuesto/types";
import { ConfirmDialog } from "./SimpleDialogs";
import { C, linkButton, Modal, TextCommit } from "./ui";

/**
 * The footer of a subpresupuesto: rows "variable = formula" computed from the
 * direct cost (CD), the general expenses factor (FGG) and the rows above.
 */
export default function PieDialog({
  doc,
  setDoc,
  spId,
  cd,
  fgg,
  canEdit,
  onClose,
}: {
  doc: PresupuestoDoc;
  setDoc: (change: (doc: PresupuestoDoc) => PresupuestoDoc) => void;
  spId: string;
  cd: number;
  fgg: number;
  canEdit: boolean;
  onClose: () => void;
}) {
  const sp = doc.subpresupuestos.find((s) => s.id === spId);
  const [selected, setSelected] = useState<number | null>(null);
  const [aplicarTodos, setAplicarTodos] = useState(false);
  const pie = useMemo(() => sp?.pie ?? [], [sp]);
  const filas = useMemo(() => calcularPie(pie, { cd, fgg }), [pie, cd, fgg]);
  if (!sp) return null;

  function setPie(change: (pie: FilaPie[]) => FilaPie[]) {
    setDoc((d) => ({ ...d, subpresupuestos: d.subpresupuestos.map((s) => (s.id === spId ? { ...s, pie: change(s.pie) } : s)) }));
  }
  function setFila(i: number, patch: Partial<FilaPie>) {
    setPie((p) => p.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  }
  const nueva = (): FilaPie => ({ variable: `V${pie.length + 1}`, descripcion: "", formula: "CD * 0", iu: "", resaltar: false });

  return (
    <Modal
      title={`Pie del Sub Presupuesto: ${sp.nombre}`}
      onClose={onClose}
      width={1180}
      height="80vh"
      toolbar={
        <>
          <button type="button" style={linkButton} onClick={onClose}>
            Aplicar
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                style={linkButton}
                onClick={() => {
                  const at = selected ?? 0;
                  setPie((p) => [...p.slice(0, at), nueva(), ...p.slice(at)]);
                  setSelected(at);
                }}
              >
                Insertar
              </button>
              <button type="button" style={linkButton} onClick={() => setAplicarTodos(true)} disabled={doc.subpresupuestos.length < 2}>
                Aplicar a todos los sub presupuestos
              </button>
            </>
          )}
        </>
      }
    >
      <div style={{ overflow: "auto", background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ ...th, width: 110 }}>Variable</th>
              <th style={th}>Descripción</th>
              <th style={{ ...th, width: 230 }}>Fórmula</th>
              <th style={{ ...th, width: 150 }}>Valor</th>
              <th style={{ ...th, width: 80 }}>IU</th>
              <th style={{ ...th, width: 90 }}>Resaltar?</th>
              <th style={{ ...th, width: 40 }} aria-label="Quitar">
                🗑
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ color: "var(--tc-gray-500)" }}>
              <td style={{ ...td, textAlign: "center" }}>CD</td>
              <td style={td}>COSTO DIRECTO</td>
              <td style={td} />
              <td style={tdNum}>{fmt(cd)}</td>
              <td style={td} />
              <td style={{ ...td, textAlign: "center" }}>
                <input type="checkbox" checked disabled aria-label="Costo directo resaltado" />
              </td>
              <td style={td} />
            </tr>
            {filas.map(({ fila, valor, error }, i) => (
              <tr key={i} onClick={() => setSelected(i)} style={{ background: selected === i ? C.rowSelected : "#fff" }}>
                <td style={{ ...td, textAlign: "center" }}>
                  {canEdit ? <TextCommit value={fila.variable} maxLength={20} onCommit={(v) => setFila(i, { variable: v.trim().toUpperCase() })} style={{ ...cellEdit, textAlign: "center" }} ariaLabel="Variable" /> : fila.variable}
                </td>
                <td style={td}>{canEdit ? <TextCommit value={fila.descripcion} onCommit={(v) => setFila(i, { descripcion: v.trim() })} style={cellEdit} ariaLabel="Descripción" /> : fila.descripcion}</td>
                <td style={td}>{canEdit ? <TextCommit value={fila.formula} maxLength={200} onCommit={(v) => setFila(i, { formula: v.trim() })} style={{ ...cellEdit, fontFamily: "Consolas, monospace" }} ariaLabel="Fórmula" /> : fila.formula}</td>
                <td style={{ ...tdNum, color: error ? "#8a1c14" : undefined, fontSize: error ? 12.5 : undefined }} title={error ?? undefined}>
                  {error ?? (valor !== null ? fmt(valor) : "")}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  {canEdit ? <TextCommit value={fila.iu} maxLength={40} onCommit={(v) => setFila(i, { iu: v.trim() })} style={{ ...cellEdit, textAlign: "center" }} ariaLabel="IU" /> : fila.iu}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={fila.resaltar} disabled={!canEdit} onChange={(e) => setFila(i, { resaltar: e.target.checked })} aria-label={`Resaltar ${fila.variable}`} />
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  {canEdit && (
                    <button type="button" style={delBtn} aria-label={`Quitar ${fila.variable}`} onClick={() => setPie((p) => p.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <button type="button" onClick={() => setPie((p) => [...p, nueva()])} style={addBtn}>
            + Agregar
          </button>
        )}
      </div>
      <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--tc-gray-500)", lineHeight: 1.6 }}>
        Las fórmulas usan <strong>CD</strong> (costo directo de este subpresupuesto), <strong>FGG</strong> (gastos generales ÷ costo directo de todo el
        presupuesto; hoy {(fgg * 100).toFixed(4)}%) y las variables de las filas de arriba, con + − × ÷ y paréntesis: p. ej. <code>CD * 0.10</code>,{" "}
        <code>CD + PGG + UTI</code>, <code>ST * 18%</code>.
      </div>
      {aplicarTodos && (
        <ConfirmDialog
          title="Aplicar a todos los subpresupuestos"
          onClose={() => setAplicarTodos(false)}
          onConfirm={() => {
            setDoc((d) => ({ ...d, subpresupuestos: d.subpresupuestos.map((s) => ({ ...s, pie: pie.map((f) => ({ ...f })) })) }));
            setAplicarTodos(false);
          }}
        >
          El pie de los demás subpresupuestos se reemplazará por este ({pie.length} filas).
        </ConfirmDialog>
      )}
    </Modal>
  );
}

const th: CSSProperties = { padding: "10px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}` };
const td: CSSProperties = { padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}`, height: 40 };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const cellEdit: CSSProperties = { width: "100%", padding: "4px 6px", border: "1px solid #e3e7ec" };
const delBtn: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#8a1c14", fontFamily: "inherit" };
const addBtn: CSSProperties = {
  display: "block",
  width: "100%",
  border: "none",
  background: "#eef0f3",
  padding: "10px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
