"use client";

import { CSSProperties, useCallback, useMemo, useState } from "react";
import { ApuCalculado, calcularApu, cuadrillaPara, LineaApu, porDia, porHora, Resolver } from "../../lib/presupuesto/calc";
import { editable as numero, fmt } from "../../lib/presupuesto/format";
import { Apu, Componente, Insumo, Rubro, RUBRO_COLORS, RUBROS } from "../../lib/presupuesto/types";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { InsumoNuevoDialog } from "./CatalogoInsumos";
import Picker from "./Picker";
import type { Catalogo } from "./usePresupuesto";
import { C, NumInput, RubroChip, Square } from "./ui";

/** What an analysis needs to offer "Crear insumo" for an insumo that isn't in the catalog yet. */
export interface CrearInsumoCfg {
  api: PresupuestoApi;
  catalogo: Catalogo;
  /** Whether the user can change the catalog. */
  canEdit: boolean;
  /** The insumo was saved in the catalog. */
  onCreated: (insumo: Insumo) => void;
}

export interface OpcionSubpartida {
  id: string;
  descripcion: string;
  unidad: string;
  /** Where it comes from ("Presupuesto", "Catálogo"), shown next to it. */
  grupo: string;
}

const ORDEN: Record<Rubro, number> = { MO: 0, MT: 1, EQ: 2, SC: 3, SP: 4 };
/** A new resource line: labor and equipment by the hour or by the day start with a crew of 1. */
export function componenteNuevo(ins: Pick<Insumo, "tipo" | "unidad">, id: string): Componente {
  const crew = (ins.tipo === "MO" || ins.tipo === "EQ") && (porHora(ins.unidad) || porDia(ins.unidad));
  return { tipo: "insumo", id, cuadrilla: crew ? 1 : null, cantidad: 0 };
}

/** Labor or equipment paid by time (HH, HM, DIA, JR): with a crew, its quantity follows the yield and the day. */
export function esPorTiempo(l: Pick<LineaApu, "componente" | "porcentaje" | "rubro" | "unidad">): boolean {
  return l.componente.tipo === "insumo" && !l.porcentaje && (l.rubro === "MO" || l.rubro === "EQ") && (porHora(l.unidad) || porDia(l.unidad));
}

/** More people or machines than this at once is most likely a quantity typed as a crew. */
const CUADRILLA_GRANDE = 20;

/** How a crew line's quantity comes out, with its numbers. */
function formulaCantidad(l: LineaApu, apu: Apu): string {
  const n = (x: number) => numero(x, 4);
  return porDia(l.unidad)
    ? `Calculada: cuadrilla ${n(l.cuadrilla ?? 0)} ÷ rendimiento ${n(apu.rendimiento)} = ${n(l.cantidad)} ${l.unidad} por unidad`
    : `Calculada: cuadrilla ${n(l.cuadrilla ?? 0)} × jornada ${n(apu.jornada)} h ÷ rendimiento ${n(apu.rendimiento)} = ${n(l.cantidad)} ${l.unidad} por unidad`;
}

export function insumoLabel(i: Pick<Insumo, "descripcion" | "unidad">): string {
  return `${i.descripcion} [${i.unidad || "-"}]`;
}

/**
 * The unit cost analysis of a partida or subpartida: yield, the totals by
 * kind (MO, MT, EQ, SC, SP, CU) and its lines. Without `onChange` it is read-only.
 */
export default function ApuEditor({
  apu,
  resolver,
  onChange,
  insumos,
  usarInsumo,
  subpartidas,
  usarSubpartida,
  onNuevaSubpartida,
  onAbrirSubpartida,
  onPrecio,
  unidad,
  maxHeight,
  calculada,
  crear,
}: {
  apu: Apu;
  resolver: Resolver;
  onChange?: (apu: Apu) => void;
  /** Resources to add from (the catalog). */
  insumos: Insumo[];
  /** Makes a resource usable here and returns the id its line points to. */
  usarInsumo?: (ins: Insumo) => string;
  subpartidas: OpcionSubpartida[];
  /** The id a chosen subpartida is used with (null: it can't be used here, e.g. it would loop). */
  usarSubpartida?: (id: string) => string | null;
  onNuevaSubpartida?: () => void;
  onAbrirSubpartida?: (id: string) => void;
  /** Changes a resource's price (everywhere it is used). */
  onPrecio?: (insumoId: string, precio: number) => void;
  unidad?: string;
  maxHeight?: number | string;
  /** Already computed (saves a pass when the caller has it). */
  calculada?: ApuCalculado;
  crear?: CrearInsumoCfg;
}) {
  const result = useMemo(() => calculada ?? calcularApu(apu, resolver), [calculada, apu, resolver]);
  const [adding, setAdding] = useState<"insumo" | "subpartida" | null>(null);
  const [aviso, setAviso] = useState("");
  const [creando, setCreando] = useState<string | null>(null);
  const editable = !!onChange;

  const lineas = useMemo(
    () => [...result.lineas].sort((a, b) => ORDEN[a.rubro] - ORDEN[b.rubro] || a.index - b.index),
    [result.lineas]
  );

  const setComponente = useCallback(
    (index: number, patch: Partial<Componente>) => {
      if (!onChange) return;
      onChange({ ...apu, componentes: apu.componentes.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
    },
    [apu, onChange]
  );

  function quitar(index: number) {
    onChange?.({ ...apu, componentes: apu.componentes.filter((_, i) => i !== index) });
  }

  function cambiarCantidad(l: LineaApu, value: number | null) {
    if (value === null) return;
    // A percentage line has no crew (one typed while it had another unit is dropped); labor and
    // equipment by time keep the crew that gives the quantity, so they follow the yield and the day.
    if (l.porcentaje) setComponente(l.index, { cantidad: value, cuadrilla: null });
    else if (l.componente.cuadrilla !== null || esPorTiempo(l)) setComponente(l.index, { cantidad: value, cuadrilla: cuadrillaPara(value, apu, l.unidad) });
    else setComponente(l.index, { cantidad: value });
  }

  /** Lines of labor or equipment by time with their quantity typed: they don't follow the yield or the day. */
  const aMano = editable ? result.lineas.filter((l) => !l.error && esPorTiempo(l) && l.componente.cuadrilla === null) : [];

  /** Turns them into crews that give the same quantity (a crew of 1 when there was none). */
  function calcularConCuadrilla() {
    if (!onChange) return;
    const cuadrillas = new Map(aMano.map((l) => [l.index, l.cantidad > 0 ? cuadrillaPara(l.cantidad, apu, l.unidad) : 1]));
    onChange({ ...apu, componentes: apu.componentes.map((c, i) => (cuadrillas.has(i) ? { ...c, cuadrilla: cuadrillas.get(i)!, cantidad: 0 } : c)) });
  }

  function cambiarCuadrilla(l: LineaApu, value: number | null) {
    // Clearing the crew keeps the quantity it gave, now typed directly.
    setComponente(l.index, value === null ? { cuadrilla: null, cantidad: l.cantidad } : { cuadrilla: value });
  }

  function agregarInsumo(ins: Insumo) {
    if (!onChange || !usarInsumo) return;
    const id = usarInsumo(ins);
    if (apu.componentes.some((c) => c.tipo === "insumo" && c.id === id)) {
      setAviso(`"${ins.descripcion}" ya está en este análisis.`);
      return;
    }
    setAviso("");
    onChange({ ...apu, componentes: [...apu.componentes, componenteNuevo(ins, id)] });
    setAdding(null);
  }

  function agregarSubpartida(op: OpcionSubpartida) {
    if (!onChange || !usarSubpartida) return;
    const id = usarSubpartida(op.id);
    if (!id) {
      setAviso(`"${op.descripcion}" no se puede usar aquí: la contiene este mismo análisis.`);
      return;
    }
    setAviso("");
    onChange({ ...apu, componentes: [...apu.componentes, { tipo: "subpartida", id, cuadrilla: null, cantidad: 1 }] });
    setAdding(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "6px 10px", background: "#f0f2f5", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 14, fontWeight: 600, color: "var(--tc-gray-700)" }}>
          Rendimiento{unidad ? ` (${unidad}/día)` : ""}
          <NumInput
            value={apu.rendimiento}
            decimals={2}
            onCommit={editable ? (v) => v && v > 0 && onChange!({ ...apu, rendimiento: v }) : undefined}
            style={{ width: 140, fontSize: 15 }}
            ariaLabel="Rendimiento"
          />
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--tc-gray-500)" }}
          title="Horas del día de trabajo. Cambia la cantidad de la mano de obra y los equipos por hora (HH, HM) con cuadrilla; los que se pagan por día solo dependen del rendimiento."
        >
          Jornada (h)
          <NumInput
            value={apu.jornada}
            decimals={1}
            onCommit={editable ? (v) => v && v > 0 && onChange!({ ...apu, jornada: v }) : undefined}
            style={{ width: 64 }}
            ariaLabel="Horas de la jornada"
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 2 }}>
          {RUBROS.map((r) => (
            <RubroChip key={r} label={r} value={result.rubros[r]} color={RUBRO_COLORS[r]} />
          ))}
          <RubroChip label="CU" value={result.cu} color="#2b2b2b" strong />
        </div>
      </div>

      {aMano.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "5px 10px", background: "#fff6e0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
          <span>
            {aMano.length === 1 ? `«${aMano[0].descripcion}» tiene` : `${aMano.length} líneas de mano de obra o equipo tienen`} la cantidad escrita a mano: no
            cambia{aMano.length === 1 ? "" : "n"} con el rendimiento ni con la jornada.
          </span>
          <button type="button" onClick={calcularConCuadrilla} style={{ ...linkLike, fontWeight: 600 }} title="Pasa cada una a la cuadrilla que da su cantidad de hoy; desde ahí se calcula sola">
            Calcular con cuadrilla
          </button>
        </div>
      )}

      <div style={{ overflow: "auto", maxHeight, flex: 1, minHeight: 0 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 13.5, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 28 }} />
            <col />
            <col style={{ width: 70 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 34 }} />
          </colgroup>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1 }}>
              <th style={th} />
              <th style={th}>Insumo</th>
              <th style={th}>Unidad</th>
              <th
                style={th}
                title="Cuántas personas o equipos trabajan a la vez (1 oficial y 2 ayudantes son dos líneas, con 1 y 2). Con ella la cantidad se calcula sola: por hora, cuadrilla × jornada ÷ rendimiento; por día, cuadrilla ÷ rendimiento."
              >
                Cuadrilla
              </th>
              <th style={th} title="Por unidad de la partida. En las líneas con cuadrilla se calcula sola; en las de %, es el porcentaje.">
                Cantidad
              </th>
              <th style={th}>PU</th>
              <th style={th}>Parcial</th>
              <th style={th} aria-label="Quitar">
                🗑
              </th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const crewEditable = editable && !l.porcentaje && l.componente.tipo === "insumo" && (l.rubro === "MO" || l.rubro === "EQ");
              const conCuadrilla = l.cuadrilla !== null && !l.error;
              const grande = conCuadrilla && l.cuadrilla! > CUADRILLA_GRANDE;
              return (
                <tr key={`${l.index}-${l.componente.id}`} style={{ background: l.error ? "#fdecea" : "#fff" }}>
                  <td style={{ ...td, textAlign: "center" }}>
                    <Square rubro={l.rubro} />
                  </td>
                  <td style={{ ...td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.error ?? l.descripcion}>
                    {l.componente.tipo === "subpartida" && onAbrirSubpartida && !l.error ? (
                      <button type="button" onClick={() => onAbrirSubpartida(l.componente.id)} style={linkLike} title="Ver o editar la subpartida">
                        {l.descripcion}
                      </button>
                    ) : (
                      l.descripcion
                    )}
                    {l.error && <span style={{ color: "#8a1c14", fontSize: 12 }}> · {l.error}</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>{l.unidad}</td>
                  <td
                    style={tdNum}
                    title={grande ? `¿${numero(l.cuadrilla ?? 0, 4)} personas o equipos a la vez? Si es una sola cuadrilla, escribe 1: la cantidad se calcula sola.` : undefined}
                  >
                    {crewEditable ? (
                      <NumInput
                        value={l.cuadrilla}
                        decimals={4}
                        allowEmpty
                        onCommit={(v) => cambiarCuadrilla(l, v)}
                        style={{ ...numCell, ...(grande ? { background: "#fff1c2", border: "1px solid #d9a400" } : {}) }}
                        ariaLabel={`Cuadrilla de ${l.descripcion}`}
                      />
                    ) : l.cuadrilla !== null ? (
                      fmt(l.cuadrilla, 4)
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={tdNum} title={conCuadrilla ? formulaCantidad(l, apu) : undefined}>
                    {editable && !l.error ? (
                      <NumInput
                        value={l.cantidad}
                        decimals={4}
                        onCommit={(v) => cambiarCantidad(l, v)}
                        style={{ ...numCell, ...(conCuadrilla ? { background: "#f1f4f8", color: "var(--tc-gray-700)" } : {}) }}
                        ariaLabel={`Cantidad de ${l.descripcion}`}
                      />
                    ) : (
                      fmt(l.cantidad, 4)
                    )}
                  </td>
                  <td style={tdNum}>
                    {onPrecio && l.componente.tipo === "insumo" && !l.porcentaje && !l.error ? (
                      <NumInput value={l.precio} decimals={2} onCommit={(v) => v !== null && onPrecio(l.componente.id, v)} style={numCell} ariaLabel={`Precio de ${l.descripcion}`} />
                    ) : (
                      fmt(l.precio)
                    )}
                  </td>
                  <td style={tdNum}>{fmt(l.parcial)}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {editable && (
                      <button type="button" onClick={() => quitar(l.index)} style={iconBtn} aria-label={`Quitar ${l.descripcion}`} title="Quitar">
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {lineas.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...td, color: "var(--tc-gray-500)", textAlign: "center", padding: 14 }}>
                  {editable ? "Sin insumos todavía: agrégalos abajo." : "Sin insumos."}
                </td>
              </tr>
            )}
            {adding && (
              <tr>
                <td style={td} />
                <td colSpan={7} style={{ ...td, overflow: "visible" }}>
                  {adding === "insumo" ? (
                    <Picker
                      options={insumos}
                      textOf={insumoSearchText}
                      render={(i) => (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Square rubro={i.tipo} /> {insumoLabel(i)}
                          <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>{fmt(i.precio)}</span>
                        </span>
                      )}
                      onPick={agregarInsumo}
                      onCancel={() => setAdding(null)}
                      noMatch={
                        crear
                          ? {
                              onEnter: (q) => crear.canEdit && setCreando(q),
                              render: (q) => (
                                <div style={floating}>
                                  <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>«{q}» no existe en la base de datos.</span>
                                  <button
                                    type="button"
                                    disabled={!crear.canEdit}
                                    title={crear.canEdit ? "Crear este insumo en el catálogo" : "No tienes permiso para modificar el catálogo de insumos"}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      if (crear.canEdit) setCreando(q);
                                    }}
                                    style={floatingBtn}
                                  >
                                    {crear.canEdit ? "Crear Insumo" : "Sin permiso para crear insumos"}
                                  </button>
                                </div>
                              ),
                            }
                          : undefined
                      }
                      placeholder="Escribe parte del nombre o el código del insumo..."
                      style={{ maxWidth: 520 }}
                    />
                  ) : (
                    <Picker
                      options={subpartidas}
                      textOf={(s) => `${s.descripcion} ${s.unidad} ${s.grupo}`}
                      keepOpen
                      render={(s) => (
                        <span>
                          {insumoLabel(s)} <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>· {s.grupo}</span>
                        </span>
                      )}
                      onPick={agregarSubpartida}
                      onCancel={() => setAdding(null)}
                      placeholder="Busca una subpartida del presupuesto o una partida del catálogo..."
                      style={{ maxWidth: 520 }}
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creando !== null && crear && (
        <InsumoNuevoDialog
          api={crear.api}
          catalogo={crear.catalogo}
          descripcion={creando}
          onClose={() => setCreando(null)}
          onCreated={(ins) => {
            crear.onCreated(ins);
            setCreando(null);
            agregarInsumo(ins);
          }}
        />
      )}
      {editable && (
        <>
          {aviso && <div style={{ padding: "4px 10px", fontSize: 12.5, color: "#7a5300", background: "#fff6e0" }}>{aviso}</div>}
          <div style={{ display: "grid", gridTemplateColumns: onNuevaSubpartida ? "1fr 1fr 1fr" : "1fr 1fr", borderTop: `1px solid ${C.border}` }}>
            <button type="button" style={addBtn} onClick={() => setAdding(adding === "insumo" ? null : "insumo")} disabled={!usarInsumo}>
              ⊕ Agregar Insumo
            </button>
            <button type="button" style={{ ...addBtn, borderLeft: `1px solid ${C.border}` }} onClick={() => setAdding(adding === "subpartida" ? null : "subpartida")} disabled={!usarSubpartida}>
              ⊕ Agregar Sub Partida
            </button>
            {onNuevaSubpartida && (
              <button type="button" style={{ ...addBtn, borderLeft: `1px solid ${C.border}` }} onClick={onNuevaSubpartida}>
                ⊕ Nueva Sub Partida
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function insumoSearchText(i: Insumo): string {
  return `${i.codigo} ${i.descripcion} ${i.unidad}`;
}

const floating: CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #8899b3", boxShadow: "0 6px 18px rgba(0,0,0,0.2)", padding: "6px 8px", whiteSpace: "nowrap" };
const floatingBtn: CSSProperties = { border: "1px solid #444", background: "#f0f0f0", borderRadius: 3, padding: "4px 10px", fontSize: 14, cursor: "pointer", fontFamily: "inherit" };
const th: CSSProperties = {
  padding: "8px 6px",
  fontWeight: 600,
  fontSize: 14,
  textAlign: "center",
  borderBottom: `1px solid ${C.border}`,
  borderRight: `1px solid ${C.grid}`,
};
const td: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}`, height: 32 };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const numCell: CSSProperties = { width: "100%", padding: "2px 4px", fontSize: 13.5 };
const iconBtn: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#8a1c14", fontFamily: "inherit" };
const linkLike: CSSProperties = { border: "none", background: "transparent", padding: 0, color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", font: "inherit" };
const addBtn: CSSProperties = {
  border: "none",
  background: "#eef0f3",
  padding: "9px 6px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--tc-gray-700)",
};
