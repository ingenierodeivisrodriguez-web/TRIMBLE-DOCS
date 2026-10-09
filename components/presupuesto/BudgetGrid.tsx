"use client";

import { CSSProperties, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { FilaPieCalculada, FilaPresupuesto, SubpresupuestoCalculado } from "../../lib/presupuesto/calc";
import { fmt } from "../../lib/presupuesto/format";
import { Rubro, RUBRO_NOMBRES } from "../../lib/presupuesto/types";
import MemoriaCantidad from "./MemoriaCantidad";
import type { ElementoVinculado } from "../../lib/presupuesto/types";
import { C, NumInput, TextCommit, useVirtual } from "./ui";

const ROW = 34;
const HEADER = 50;
const COLUMNS = "64px minmax(300px, 1fr) 72px 104px 100px 124px 118px 118px 110px 112px 110px";
const MIN_WIDTH = 1300;
const RUBRO_COLS: Rubro[] = ["MO", "MT", "EQ", "SC", "SP"];

export type CampoEditable = "descripcion" | "unidad" | "metrado";

/** Rows hidden by collapsed titles are left out. */
export function filasVisibles(filas: FilaPresupuesto[], collapsed: Set<string>): FilaPresupuesto[] {
  const out: FilaPresupuesto[] = [];
  let hideBelow: number | null = null;
  for (const f of filas) {
    if (hideBelow !== null) {
      if (f.item.nivel > hideBelow) continue;
      hideBelow = null;
    }
    out.push(f);
    if (f.item.tipo === "titulo" && collapsed.has(f.item.id)) hideBelow = f.item.nivel;
  }
  return out;
}

/**
 * The budget as a table: titles and partidas with their number, quantity,
 * unit cost, amount and its split by kind; the footer rows close it.
 */
export default function BudgetGrid({
  calculado,
  pie,
  selectedId,
  onSelect,
  collapsed,
  onToggle,
  editable,
  onEdit,
  onOpen,
  elementos,
  loadMemoria,
}: {
  calculado: SubpresupuestoCalculado;
  pie: FilaPieCalculada[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  editable: boolean;
  onEdit: (itemId: string, field: CampoEditable, value: string | number) => void;
  /** Opens the row's dialog (double click on the item number). */
  onOpen: (itemId: string) => void;
  /** Model elements linked to each partida. */
  elementos: Map<string, number>;
  /** The linked elements of a partida (for its memoria de cantidades). */
  loadMemoria: (itemId: string) => Promise<ElementoVinculado[]>;
}) {
  const visibles = useMemo(() => filasVisibles(calculado.filas, collapsed), [calculado.filas, collapsed]);
  const { ref, start, end, padTop, padBottom, reveal } = useVirtual(visibles.length, ROW);
  const [editing, setEditing] = useState<{ id: string; field: CampoEditable } | null>(null);
  const [memoriaId, setMemoriaId] = useState<string | null>(null);
  const memoriaIndex = memoriaId ? visibles.findIndex((f) => f.item.id === memoriaId) : -1;
  const selectedIndex = visibles.findIndex((f) => f.item.id === selectedId);

  useEffect(() => {
    if (selectedIndex >= 0) reveal(selectedIndex, HEADER);
  }, [selectedIndex, reveal]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (editing || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(visibles.length - 1, Math.max(0, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
      if (visibles[next]) onSelect(visibles[next].item.id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const f = visibles[selectedIndex];
      if (f?.item.tipo === "titulo" && collapsed.has(f.item.id) === (e.key === "ArrowRight")) onToggle(f.item.id);
    } else if (e.key === "F2" && editable && selectedId) {
      setEditing({ id: selectedId, field: "descripcion" });
    }
  }

  function startEdit(f: FilaPresupuesto, field: CampoEditable) {
    if (!editable) return;
    if (field !== "descripcion" && f.item.tipo === "titulo") return;
    if (field === "metrado" && f.metradoModelo) return;
    setEditing({ id: f.item.id, field });
  }

  const isEditing = (f: FilaPresupuesto, field: CampoEditable) => editing?.id === f.item.id && editing.field === field;
  const finish = (f: FilaPresupuesto, field: CampoEditable, value: string | number | null) => {
    setEditing(null);
    if (value !== null) onEdit(f.item.id, field, value);
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff", outline: "none", position: "relative" }}
      aria-label="Partidas del subpresupuesto"
    >
      <div style={{ minWidth: MIN_WIDTH, position: "relative" }}>
        <div style={{ ...rowGrid, height: HEADER, position: "sticky", top: 0, zIndex: 2, background: "#f3f4f6", borderBottom: `1px solid ${C.border}`, fontWeight: 600, fontSize: 14 }}>
          <div style={headCell}>Item</div>
          <div style={headCell}>Partida</div>
          <div style={headCell}>Unidad</div>
          <div style={headCell}>Metrado</div>
          <div style={headCell}>CU</div>
          <HeadTotal label="Parcial" value={calculado.cd} />
          {RUBRO_COLS.map((r) => (
            <HeadTotal key={r} label={RUBRO_NOMBRES[r]} value={calculado.rubros[r]} />
          ))}
        </div>

        <div style={{ height: padTop }} />
        {visibles.slice(start, end).map((f) => {
          const selected = f.item.id === selectedId;
          const titulo = f.item.tipo === "titulo";
          const n = elementos.get(f.item.id) ?? 0;
          return (
            <div
              key={f.item.id}
              onMouseDown={() => onSelect(f.item.id)}
              style={{
                ...rowGrid,
                height: ROW,
                background: selected ? C.rowSelected : "#fff",
                fontWeight: titulo ? 700 : 400,
                borderBottom: `1px solid ${C.grid}`,
                fontSize: 14,
              }}
            >
              <div style={{ ...cell, justifyContent: "flex-end", cursor: "default" }} onDoubleClick={() => onOpen(f.item.id)} title="Doble clic para abrir">
                {f.numero}
              </div>
              <div style={{ ...cell, paddingLeft: 6 + f.item.nivel * 16, gap: 4 }} onDoubleClick={() => startEdit(f, "descripcion")}>
                {titulo ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(f.item.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={collapsed.has(f.item.id) ? "Expandir" : "Contraer"}
                    style={toggleBtn}
                  >
                    {collapsed.has(f.item.id) ? "▶" : "▼"}
                  </button>
                ) : null}
                {isEditing(f, "descripcion") ? (
                  <TextCommit
                    value={f.item.descripcion}
                    autoFocus
                    onCommit={(v) => finish(f, "descripcion", v.trim() || null)}
                    style={{ width: "100%", padding: "2px 6px", fontWeight: titulo ? 700 : 400 }}
                    ariaLabel="Descripción"
                  />
                ) : (
                  <span style={ellipsis} title={f.item.descripcion}>
                    {f.item.descripcion}
                  </span>
                )}
                {!titulo && n > 0 && !isEditing(f, "descripcion") && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(f.item.id);
                      setMemoriaId(memoriaId === f.item.id ? null : f.item.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={memoriaId === f.item.id ? "Cerrar la memoria de cantidades" : "Ver la memoria de cantidades"}
                    aria-expanded={memoriaId === f.item.id}
                    title={`Memoria de cantidades: ${n} elemento(s) del modelo`}
                    style={memoriaBtn}
                  >
                    {memoriaId === f.item.id ? "▲" : "▼"} {n}
                  </button>
                )}
              </div>
              <div style={{ ...cell, justifyContent: "center" }} onDoubleClick={() => startEdit(f, "unidad")}>
                {f.item.tipo === "partida" &&
                  (isEditing(f, "unidad") ? (
                    <TextCommit value={f.item.unidad} autoFocus maxLength={20} onCommit={(v) => finish(f, "unidad", v.trim())} style={{ width: "100%", padding: "2px 4px", textAlign: "center" }} ariaLabel="Unidad" />
                  ) : (
                    f.item.unidad
                  ))}
              </div>
              <div style={{ ...numCellStyle, fontWeight: 700 }} onDoubleClick={() => startEdit(f, "metrado")}>
                {f.metrado !== null &&
                  (isEditing(f, "metrado") ? (
                    <NumInput value={f.metrado} decimals={2} autoFocus onCommit={(v) => finish(f, "metrado", v)} style={{ width: "100%", padding: "2px 4px" }} ariaLabel="Metrado" />
                  ) : (
                    <>
                      {f.metradoModelo ? (
                        <span title={`Metrado del modelo: ${f.metradoModelo.elementos} elemento(s) · ${f.metradoModelo.campoLabel}`} style={badge3d}>
                          3D
                        </span>
                      ) : (
                        <span
                          title={n > 0 ? `Metrado manual (la partida tiene ${n} elemento(s) del modelo asociados)` : "Metrado manual"}
                          style={{ ...badge3d, background: "#e9edf2", color: "var(--tc-gray-500)" }}
                        >
                          Manual
                        </span>
                      )}
                      {fmt(f.metrado)}
                    </>
                  ))}
              </div>
              <div style={numCellStyle}>{f.cu !== null ? fmt(f.cu) : ""}</div>
              <div style={{ ...numCellStyle, fontWeight: titulo ? 700 : 400 }}>{fmt(f.parcial)}</div>
              {RUBRO_COLS.map((r) => (
                <div key={r} style={{ ...numCellStyle, fontStyle: "italic", fontWeight: titulo ? 700 : 400 }}>
                  {fmt(f.rubros[r])}
                </div>
              ))}
            </div>
          );
        })}
        <div style={{ height: padBottom }} />

        {memoriaId && memoriaIndex >= 0 && visibles[memoriaIndex].item.tipo === "partida" && (
          <div style={{ position: "absolute", top: HEADER + (memoriaIndex + 1) * ROW, left: 70, zIndex: 3 }}>
            <MemoriaCantidad
              itemId={memoriaId}
              titulo={`${visibles[memoriaIndex].numero} ${visibles[memoriaIndex].item.descripcion}`}
              unidad={visibles[memoriaIndex].item.tipo === "partida" ? (visibles[memoriaIndex].item as { unidad: string }).unidad : ""}
              load={loadMemoria}
              onClose={() => setMemoriaId(null)}
            />
          </div>
        )}

        {visibles.length === 0 && (
          <div style={{ padding: 24, color: "var(--tc-gray-500)", fontSize: 14 }}>
            {editable
              ? "Este subpresupuesto está vacío. Empieza con \"+ Título\" y luego \"+ Partida\" (o desde el Catálogo de partidas)."
              : "Este subpresupuesto está vacío."}
          </div>
        )}

        <div style={{ borderTop: `2px solid ${C.border}`, background: "#fafbfc" }}>
          <PieRow label="COSTO DIRECTO" variable="CD" value={calculado.cd} strong />
          {pie.map((p, i) => (
            <PieRow key={i} label={p.fila.descripcion} variable={p.fila.variable} value={p.valor} error={p.error} strong={p.fila.resaltar} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HeadTotal({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ ...headCell, flexDirection: "column", alignItems: "flex-end", justifyContent: "center", lineHeight: 1.2 }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{fmt(value)}</span>
    </div>
  );
}

function PieRow({ label, variable, value, error, strong }: { label: string; variable: string; value: number | null; error?: string | null; strong?: boolean }) {
  return (
    <div style={{ ...rowGrid, height: 30, fontSize: 14, fontWeight: strong ? 700 : 400 }}>
      <div style={{ ...cell, justifyContent: "flex-end", color: "var(--tc-gray-500)", fontWeight: 400 }}>{variable}</div>
      <div style={{ ...cell, paddingLeft: 6 }}>{label}</div>
      <div style={cell} />
      <div style={cell} />
      <div style={cell} />
      <div style={{ ...numCellStyle, color: error ? "#8a1c14" : undefined }} title={error ?? undefined}>
        {error ? "Error" : value !== null ? fmt(value) : ""}
      </div>
    </div>
  );
}

const rowGrid: CSSProperties = { display: "grid", gridTemplateColumns: COLUMNS, alignItems: "stretch" };
const cell: CSSProperties = { display: "flex", alignItems: "center", padding: "0 6px", borderRight: `1px solid ${C.grid}`, overflow: "hidden", minWidth: 0 };
const headCell: CSSProperties = { ...cell, justifyContent: "center", textAlign: "center" };
const numCellStyle: CSSProperties = { ...cell, justifyContent: "flex-end", fontVariantNumeric: "tabular-nums", gap: 6 };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const toggleBtn: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--tc-gray-500)", padding: "0 2px", fontFamily: "inherit" };
const memoriaBtn: CSSProperties = { border: "1px solid #b9c6dc", background: "#f3f7fd", color: "var(--tc-blue-800)", borderRadius: 4, padding: "0 6px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, lineHeight: "18px" };
const badge3d: CSSProperties = { fontSize: 10, fontWeight: 700, background: "#dbe8fb", color: "var(--tc-blue-800)", borderRadius: 3, padding: "1px 4px" };
