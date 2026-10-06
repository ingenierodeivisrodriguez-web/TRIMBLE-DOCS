"use client";

import { CSSProperties, useState } from "react";
import { parcialGasto, totalGastos, totalTituloGasto } from "../../lib/presupuesto/calc";
import { nuevoId } from "../../lib/presupuesto/doc";
import { exportarExcel } from "../../lib/presupuesto/excel";
import { fmt } from "../../lib/presupuesto/format";
import { exportarPdf } from "../../lib/presupuesto/pdf";
import { tablaGastos } from "../../lib/presupuesto/reportes";
import { FORMATO_LABELS, FormatoGasto, GastosGenerales as Gastos, ItemGasto, PresupuestoDoc, TituloGasto } from "../../lib/presupuesto/types";
import { TextoDialog } from "./SimpleDialogs";
import { baseInput, C, linkButton, message, Modal, Notice, NumInput, TextCommit } from "./ui";

type Grupo = keyof Gastos;
const GRUPOS: { key: Grupo; label: string }[] = [
  { key: "fijos", label: "GASTOS GENERALES FIJOS" },
  { key: "variables", label: "GASTOS GENERALES VARIABLES" },
];

/**
 * General expenses (indirect costs not in the model): titles with their
 * items, fixed and variable. Their total over the whole direct cost is the
 * factor FGG the budget footer uses.
 */
export default function GastosGenerales({
  doc,
  setDoc,
  cdTotal,
  canEdit,
  onSave,
  saving,
  proyecto,
  onClose,
}: {
  doc: PresupuestoDoc;
  setDoc: (change: (doc: PresupuestoDoc) => PresupuestoDoc) => void;
  /** Direct cost of every subpresupuesto. */
  cdTotal: number;
  canEdit: boolean;
  onSave: () => void;
  saving: boolean;
  proyecto: string;
  onClose: () => void;
}) {
  const [grupo, setGrupo] = useState<Grupo>("fijos");
  const [selectedId, setSelectedId] = useState<string | null>(doc.gastos.fijos[0]?.id ?? null);
  const [nuevoTitulo, setNuevoTitulo] = useState(false);
  const [error, setError] = useState("");
  const titulos = doc.gastos[grupo];
  const selected = titulos.find((t) => t.id === selectedId) ?? null;
  const totales = totalGastos(doc.gastos);
  const pgg = cdTotal > 0 ? (totales.total / cdTotal) * 100 : 0;
  const gi = GRUPOS.findIndex((g) => g.key === grupo) + 1;

  function setTitulos(change: (list: TituloGasto[]) => TituloGasto[]) {
    setDoc((d) => ({ ...d, gastos: { ...d.gastos, [grupo]: change(d.gastos[grupo]) } }));
  }
  function setTitulo(id: string, patch: Partial<TituloGasto>) {
    setTitulos((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function setItem(tituloId: string, itemId: string, patch: Partial<ItemGasto>) {
    setTitulos((list) => list.map((t) => (t.id === tituloId ? { ...t, items: t.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : t)));
  }

  async function exportar(tipo: "pdf" | "xlsx") {
    setError("");
    try {
      const tabla = tablaGastos(doc.gastos, cdTotal);
      if (tipo === "pdf") await exportarPdf(tabla, proyecto, "Gastos generales");
      else await exportarExcel([tabla], "Gastos generales.xlsx");
    } catch (err) {
      setError(message(err));
    }
  }

  const personal = selected?.formato === "personal";
  return (
    <Modal
      title="Gastos Generales"
      onClose={onClose}
      width={1200}
      height="90vh"
      toolbar={
        <>
          {canEdit && (
            <>
              <button type="button" style={linkButton} onClick={onSave} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
              <span style={sep} />
              <button type="button" style={linkButton} onClick={() => setNuevoTitulo(true)}>
                + Título
              </button>
            </>
          )}
          <select
            value={grupo}
            onChange={(e) => {
              const g = e.target.value as Grupo;
              setGrupo(g);
              setSelectedId(doc.gastos[g][0]?.id ?? null);
            }}
            style={{ ...baseInput, fontSize: 14 }}
            aria-label="Grupo de gastos"
          >
            {GRUPOS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <span style={sep} />
          <button type="button" style={linkButton} onClick={() => exportar("pdf")}>
            PDF
          </button>
          <button type="button" style={linkButton} onClick={() => exportar("xlsx")}>
            Hoja de Cálculo
          </button>
          <span style={sep} />
          <strong style={{ fontSize: 15, padding: "0 6px" }} title="Gastos generales ÷ costo directo de todo el presupuesto">
            PGG = {pgg.toFixed(4)}% &nbsp; GG = {fmt(totales.total)}
          </strong>
        </>
      }
    >
      {error && <Notice kind="error" style={{ margin: "8px 10px 0" }}>{error}</Notice>}
      <div style={{ flex: "1 1 40%", minHeight: 140, overflow: "auto", background: "#fff" }}>
        <table style={table}>
          <thead>
            <tr style={headRow}>
              <th style={{ ...th, width: 90 }}>Item</th>
              <th style={th}>Título</th>
              <th style={{ ...th, width: 160 }}>Parcial</th>
              <th style={{ ...th, width: 40 }} aria-label="Quitar">
                🗑
              </th>
            </tr>
          </thead>
          <tbody>
            {titulos.map((t, i) => (
              <tr key={t.id} onClick={() => setSelectedId(t.id)} style={{ background: t.id === selectedId ? C.rowSelected : "#fff" }}>
                <td style={{ ...td, textAlign: "right" }}>
                  {gi}.{i + 1}
                </td>
                <td style={td}>
                  {canEdit ? (
                    <TextCommit value={t.descripcion} onCommit={(v) => v.trim() && setTitulo(t.id, { descripcion: v.trim() })} style={cellEdit} ariaLabel="Título" />
                  ) : (
                    t.descripcion
                  )}
                </td>
                <td style={tdNum}>{fmt(totalTituloGasto(t))}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  {canEdit && (
                    <button
                      type="button"
                      style={delBtn}
                      aria-label={`Quitar ${t.descripcion}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTitulos((list) => list.filter((x) => x.id !== t.id));
                        if (selectedId === t.id) setSelectedId(null);
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {titulos.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...td, color: "var(--tc-gray-500)", padding: 16 }}>
                  {canEdit ? "Sin títulos: crea uno con \"+ Título\" (p. ej. Personal, Ensayos, Seguros)." : "Sin gastos en este grupo."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ flex: "1 1 60%", minHeight: 200, display: "flex", flexDirection: "column", borderTop: `2px solid ${C.border}` }}>
        {selected ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--tc-gray-500)" }}>
                Formato:
                <select
                  value={selected.formato}
                  disabled={!canEdit}
                  onChange={(e) => setTitulo(selected.id, { formato: e.target.value as FormatoGasto })}
                  style={{ ...baseInput, fontSize: 14 }}
                >
                  {(Object.keys(FORMATO_LABELS) as FormatoGasto[]).map((f) => (
                    <option key={f} value={f}>
                      {FORMATO_LABELS[f]}
                    </option>
                  ))}
                </select>
              </label>
              {canEdit && (
                <button
                  type="button"
                  style={linkButton}
                  onClick={() =>
                    setTitulo(selected.id, {
                      items: [...selected.items, { id: nuevoId(), descripcion: "", unidad: "", cantidad: 1, precio: 0, participacion: 100, tiempo: 1 }],
                    })
                  }
                >
                  + Agregar item
                </button>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff" }}>
              <table style={table}>
                <thead>
                  <tr style={headRow}>
                    <th style={{ ...th, width: 90 }}>Item</th>
                    <th style={th}>Descripción</th>
                    <th style={{ ...th, width: 90 }}>Unidad</th>
                    <th style={{ ...th, width: 110 }}>Cantidad</th>
                    {personal && <th style={{ ...th, width: 110 }}>% Particip.</th>}
                    {personal && <th style={{ ...th, width: 100 }}>Tiempo</th>}
                    <th style={{ ...th, width: 130 }}>{personal ? "Sueldo / precio" : "Precio"}</th>
                    <th style={{ ...th, width: 140 }}>Parcial</th>
                    <th style={{ ...th, width: 40 }} aria-label="Quitar">
                      🗑
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((it, k) => (
                    <tr key={it.id}>
                      <td style={{ ...td, textAlign: "right" }}>
                        {gi}.{titulos.indexOf(selected) + 1}.{k + 1}
                      </td>
                      <td style={td}>
                        {canEdit ? <TextCommit value={it.descripcion} autoFocus={!it.descripcion} onCommit={(v) => setItem(selected.id, it.id, { descripcion: v.trim() })} style={cellEdit} ariaLabel="Descripción" /> : it.descripcion}
                      </td>
                      <td style={td}>
                        {canEdit ? <TextCommit value={it.unidad} maxLength={20} onCommit={(v) => setItem(selected.id, it.id, { unidad: v.trim() })} style={{ ...cellEdit, textAlign: "center" }} ariaLabel="Unidad" /> : it.unidad}
                      </td>
                      <NumCell value={it.cantidad} edit={canEdit} onCommit={(v) => setItem(selected.id, it.id, { cantidad: v })} label="Cantidad" />
                      {personal && <NumCell value={it.participacion} edit={canEdit} onCommit={(v) => setItem(selected.id, it.id, { participacion: v })} label="Participación" />}
                      {personal && <NumCell value={it.tiempo} edit={canEdit} onCommit={(v) => setItem(selected.id, it.id, { tiempo: v })} label="Tiempo" />}
                      <NumCell value={it.precio} edit={canEdit} onCommit={(v) => setItem(selected.id, it.id, { precio: v })} label="Precio" />
                      <td style={tdNum}>{fmt(parcialGasto(it, selected.formato))}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {canEdit && (
                          <button type="button" style={delBtn} aria-label="Quitar item" onClick={() => setTitulo(selected.id, { items: selected.items.filter((x) => x.id !== it.id) })}>
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ padding: 16, color: "var(--tc-gray-500)", fontSize: 14 }}>Elige un título para ver y editar sus items.</div>
        )}
      </div>

      {nuevoTitulo && (
        <TextoDialog
          title="Nuevo título de gastos"
          label="Título"
          onClose={() => setNuevoTitulo(false)}
          onAccept={(text) => {
            const t: TituloGasto = { id: nuevoId(), descripcion: text, formato: "general", items: [] };
            setTitulos((list) => [...list, t]);
            setSelectedId(t.id);
            setNuevoTitulo(false);
          }}
        />
      )}
    </Modal>
  );
}

function NumCell({ value, edit, onCommit, label }: { value: number; edit: boolean; onCommit: (v: number) => void; label: string }) {
  return (
    <td style={tdNum}>
      {edit ? <NumInput value={value} decimals={2} onCommit={(v) => v !== null && onCommit(v)} style={{ width: "100%", padding: "2px 4px" }} ariaLabel={label} /> : fmt(value)}
    </td>
  );
}

const table: CSSProperties = { borderCollapse: "collapse", width: "100%", fontSize: 14.5 };
const headRow: CSSProperties = { position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1 };
const th: CSSProperties = { padding: "9px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}` };
const td: CSSProperties = { padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}`, height: 36 };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const cellEdit: CSSProperties = { width: "100%", padding: "3px 6px", border: "1px solid #e3e7ec" };
const delBtn: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#8a1c14", fontFamily: "inherit" };
const sep: CSSProperties = { width: 1, height: 22, background: C.border, margin: "0 6px" };
