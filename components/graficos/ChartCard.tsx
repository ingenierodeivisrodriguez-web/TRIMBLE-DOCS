"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assignColors, ColorGroup, COMPARE_COLORS, MAX_COLORED_ROWS } from "../../lib/graficos/colors";
import {
  aggregate,
  bucketCounts,
  CommonField,
  compare,
  foldCompareRows,
  foldRows,
  formatNumber,
  GENERAL_GROUP,
  Members,
  mergeMembers,
  ModelDataset,
} from "../../lib/graficos/modelData";
import type { ChartReportData } from "../../lib/graficos/insights";
import type { CardSpec, ChartType } from "../../lib/graficos/savedViews";
import {
  ColumnChart,
  CompareChart,
  CompareSide,
  DonutChart,
  HorizontalBarChart,
  MAX_COLUMNS,
  MAX_COMPARE_GROUPS,
  MAX_HORIZONTAL_BARS,
  MAX_SLICES,
} from "./Charts";

export type { CardSpec, ChartType };

export const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "column", label: "Barras verticales" },
  { type: "horizontal", label: "Barras horizontales" },
  { type: "donut", label: "Circular" },
  { type: "compare", label: "Comparativo A vs B" },
];

export const FIELD_DRAG_TYPE = "application/x-graficos-field";

const TABLE_ROW_LIMIT = 200;

type DropTarget = "card" | "category" | "value" | "compare";

export function fieldLabel(field: CommonField): string {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

export function kindMark(field: CommonField): string {
  return field.kind === "number" ? "#" : field.kind === "date" ? "📅" : "Aa";
}

function chartTypeLabel(type: ChartType): string {
  return CHART_TYPES.find((t) => t.type === type)?.label ?? type;
}

function optionLabel(field: CommonField): string {
  return field.group === GENERAL_GROUP ? fieldLabel(field) : `${fieldLabel(field)} — ${field.group}`;
}

function acceptsDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(FIELD_DRAG_TYPE);
}

/** What the PDF report needs from a card, read at export time. */
export interface CardReport extends ChartReportData {
  legend?: { color: string; label: string }[];
  /** How the model is painted "según el gráfico" (the same groups "Colorear" applies). */
  colorGroups: ColorGroup[];
  svg: SVGSVGElement | null;
}

export default function ChartCard({
  spec,
  fields,
  datasets,
  onChange,
  selection,
  onSelectObjects,
  onClearSelection,
  colored,
  onToggleColors,
  onApplyColors,
  colorVersion,
  exportMode,
  registerReport,
}: {
  spec: CardSpec;
  fields: CommonField[];
  /** Already filtered by the slicers; null while the selected models are still being read. */
  datasets: ModelDataset[] | null;
  /** Receives an updater of the latest spec, so quick successive drops never overwrite each other. */
  onChange: (update: (prev: CardSpec) => CardSpec) => void;
  /** The bar / slice of this chart whose objects are selected in the viewer, if any. */
  selection: { key: string; count: number } | null;
  onSelectObjects: (key: string, members: Members) => void;
  onClearSelection: () => void;
  /** This chart is the one painting the model ("Colorear" on). */
  colored: boolean;
  onToggleColors: () => void;
  onApplyColors: (groups: ColorGroup[]) => void;
  /** Bumped by the parent to ask the colored chart to paint the model again. */
  colorVersion: number;
  /** While a PDF is being generated: chart view, colored, no animation, no highlight. */
  exportMode: boolean;
  registerReport: (getReport: (() => CardReport | null) | null) => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const [dragOver, setDragOver] = useState<DropTarget | null>(null);
  const [notice, setNotice] = useState("");
  const chartArea = useRef<HTMLDivElement>(null);

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const numericFields = fields.filter((f) => f.kind === "number");
  const compareFields = [...fields.filter((f) => f.kind === "date"), ...fields.filter((f) => f.kind === "text")];

  const isCompare = spec.type === "compare";
  const category = spec.category ? byKey.get(spec.category) : undefined;
  const value = spec.value ? byKey.get(spec.value) : undefined;
  const compareField = spec.compareBy ? byKey.get(spec.compareBy) : undefined;

  const periods = useMemo(
    () => (isCompare && datasets && compareField ? bucketCounts(datasets, compareField.key, compareField.kind) : []),
    [isCompare, datasets, compareField]
  );
  const periodKeys = periods.map((p) => p.key);
  // Default to the two latest months (or the two most common values).
  const defaultA = compareField?.kind === "date" ? periodKeys[periodKeys.length - 2] : periodKeys[0];
  const defaultB = compareField?.kind === "date" ? periodKeys[periodKeys.length - 1] : periodKeys[1];
  const periodA = spec.periodA && periodKeys.includes(spec.periodA) ? spec.periodA : (defaultA ?? periodKeys[0]);
  const periodB = spec.periodB && periodKeys.includes(spec.periodB) ? spec.periodB : (defaultB ?? periodKeys[0]);
  const periodLabel = (key: string | undefined) => periods.find((p) => p.key === key)?.label ?? "";
  const labelA = `A: ${periodLabel(periodA)}`;
  const labelB = `B: ${periodLabel(periodB)}`;

  const single = useMemo(
    () =>
      !isCompare && datasets && category
        ? aggregate(datasets, { category: category.key, categoryKind: category.kind, value: value?.key ?? null })
        : null,
    [isCompare, datasets, category, value]
  );
  const comparison = useMemo(
    () =>
      isCompare && datasets && category && compareField && periodA && periodB
        ? compare(datasets, {
            category: category.key,
            categoryKind: category.kind,
            value: value?.key ?? null,
            compareBy: compareField.key,
            compareKind: compareField.kind,
            periodA,
            periodB,
          })
        : null,
    [isCompare, datasets, category, value, compareField, periodA, periodB]
  );

  const chronological = category?.kind === "date";
  const unitLabel = value ? (value.unit ?? "") : "objetos";
  const valueTitle = value ? fieldLabel(value) : "Cantidad de objetos";
  const title = !category
    ? "Sin datos asignados"
    : isCompare && compareField && periodA && periodB
      ? `${valueTitle} por ${fieldLabel(category)}: ${periodLabel(periodA)} vs ${periodLabel(periodB)}`
      : `${valueTitle} por ${fieldLabel(category)}`;

  function place(key: string, target: DropTarget) {
    const field = byKey.get(key);
    if (!field) return;
    setNotice("");
    if (target === "compare") {
      if (field.kind === "number") {
        setNotice(`Para comparar se usa un dato de fecha (se compara por mes) o de texto (p. ej. una fase), no uno numérico.`);
        return;
      }
      onChange((prev) => ({ ...prev, compareBy: key, periodA: null, periodB: null }));
      return;
    }
    if (target === "category" || (target === "card" && field.kind !== "number")) {
      onChange((prev) => ({ ...prev, category: key }));
      return;
    }
    if (field.kind !== "number") {
      setNotice(`"${field.label}" no es numérico: solo se pueden sumar datos numéricos (longitud, área, volumen...).`);
      return;
    }
    // A number still needs categories to split by; "Modelo" always exists,
    // and the user can swap it for any other field.
    onChange((prev) => ({
      ...prev,
      value: key,
      category: prev.category && byKey.has(prev.category) ? prev.category : "@model",
    }));
  }

  function dropHandlers(target: DropTarget) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!acceptsDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(target);
      },
      onDragLeave: (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOver((current) => (current === target ? null : current));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(null);
        const key = e.dataTransfer.getData(FIELD_DRAG_TYPE);
        if (key) place(key, target);
      },
    };
  }

  // With colors on, bars fold down to what the palette can color distinctly
  // (8 hues + gray "Otros"), so every bar and its objects share one color.
  const showColors = colored || exportMode;
  const singleRows = useMemo(() => single?.rows ?? [], [single]);
  const chartRows = useMemo(() => {
    const max = spec.type === "column" ? MAX_COLUMNS : spec.type === "horizontal" ? MAX_HORIZONTAL_BARS : MAX_SLICES;
    return foldRows(singleRows, showColors ? Math.min(max, MAX_COLORED_ROWS) : max, chronological);
  }, [singleRows, spec.type, showColors, chronological]);
  const compareRows = useMemo(
    () => foldCompareRows(comparison?.rows ?? [], MAX_COMPARE_GROUPS, chronological),
    [comparison, chronological]
  );
  const rowColors = useMemo(() => assignColors(chartRows.filter((r) => spec.type !== "donut" || r.value > 0)), [chartRows, spec.type]);
  const result = isCompare ? comparison : single;
  const hasRows = isCompare ? compareRows.length > 0 : singleRows.length > 0;
  const folded = isCompare ? compareRows.length < (comparison?.rows.length ?? 0) : chartRows.length < singleRows.length;
  const activeKey = exportMode ? null : (selection?.key ?? null);
  const tableView = showTable && !exportMode;

  // The same colors the chart shows, as groups of objects to paint in the model.
  const colorGroups = useMemo<ColorGroup[]>(() => {
    if (isCompare) {
      if (compareRows.length === 0) return [];
      return [
        { color: COMPARE_COLORS.A, label: labelA, members: mergeMembers(compareRows.map((r) => r.membersA)) },
        { color: COMPARE_COLORS.B, label: labelB, members: mergeMembers(compareRows.map((r) => r.membersB)) },
      ];
    }
    const colorable = spec.type === "donut" ? chartRows.filter((r) => r.value > 0) : chartRows;
    return colorable.map((row, i) => ({ color: rowColors[i], label: row.label, members: row.members }));
  }, [isCompare, compareRows, labelA, labelB, spec.type, chartRows, rowColors]);

  useEffect(() => {
    if (colored) onApplyColors(colorGroups);
    // colorVersion: repaint on request (e.g. after a PDF export borrowed the model's colors).
  }, [colored, colorGroups, colorVersion, onApplyColors]);

  // Hand the report builder a getter over this render's data.
  useEffect(() => {
    registerReport(() => {
      if (!category || !result || !hasRows) return null;
      // The chart's own surface: legend icons are small SVGs with the same class.
      const svg = chartArea.current?.querySelector(".recharts-wrapper > svg.recharts-surface") as SVGSVGElement | null;
      const base = {
        typeLabel: chartTypeLabel(spec.type),
        title,
        categoryTitle: fieldLabel(category),
        valueTitle,
        valueName: value?.label ?? null,
        unit: value ? (value.unit ?? "") : "objetos",
        chronological,
        coverage: { withData: result.objectsWithData, total: result.totalObjects },
        colorGroups,
        svg,
      };
      if (isCompare) {
        return {
          ...base,
          compare: {
            labelA: periodLabel(periodA),
            labelB: periodLabel(periodB),
            rows: compareRows.map((r) => ({ label: r.label, a: r.a, b: r.b })),
          },
          legend: colorGroups.map((g) => ({ color: g.color, label: g.label })),
        };
      }
      const shown = spec.type === "donut" ? chartRows.filter((r) => r.value > 0) : chartRows;
      return {
        ...base,
        single: {
          rows: shown.map((row, i) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            objects: row.objects,
            color: colorGroups[i]?.color ?? rowColors[i],
          })),
        },
      };
    });
  });
  useEffect(() => () => registerReport(null), [registerReport]);

  return (
    <section
      {...dropHandlers("card")}
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: dragOver === "card" ? "0 0 0 2px var(--tc-blue-500), var(--tc-shadow)" : "var(--tc-shadow)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <select
            value={spec.type}
            onChange={(e) => {
              const type = e.target.value as ChartType;
              onChange((prev) => ({ ...prev, type }));
            }}
            style={typeSelectStyle}
            aria-label="Tipo de gráfico"
          >
            {CHART_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <h3 style={{ margin: "4px 0 0", fontSize: 14.5, color: "var(--tc-blue-800)", wordBreak: "break-word" }}>
            {title}
          </h3>
        </div>
        {result && hasRows && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <button type="button" onClick={() => setShowTable((v) => !v)} style={linkButtonStyle}>
              {showTable ? "Ver gráfico" : "Ver tabla"}
            </button>
            <button
              type="button"
              onClick={onToggleColors}
              style={colored ? colorButtonActiveStyle : colorButtonStyle}
              aria-pressed={colored}
              title="Pinta cada categoría con su color en el gráfico y en el modelo 3D"
            >
              {colored ? "✓ Coloreado" : "🎨 Colorear"}
            </button>
          </div>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center" }}>
        <SlotLabel>Categorías</SlotLabel>
        <Slot highlighted={dragOver === "category"} {...dropHandlers("category")}>
          <select
            value={category?.key ?? ""}
            disabled={fields.length === 0}
            onChange={(e) => {
              const next = e.target.value || null;
              onChange((prev) => ({ ...prev, category: next }));
            }}
            style={selectStyle}
            aria-label="Categorías"
          >
            <option value="">Arrastra o elige un dato...</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {optionLabel(f)}
              </option>
            ))}
          </select>
        </Slot>
        <SlotLabel>Valor</SlotLabel>
        <Slot highlighted={dragOver === "value"} {...dropHandlers("value")}>
          <select
            value={value?.key ?? ""}
            disabled={fields.length === 0}
            onChange={(e) => {
              const next = e.target.value || null;
              onChange((prev) => ({ ...prev, value: next }));
            }}
            style={selectStyle}
            aria-label="Valor"
          >
            <option value="">Cantidad de objetos</option>
            {numericFields.map((f) => (
              <option key={f.key} value={f.key}>
                Suma de {optionLabel(f)}
              </option>
            ))}
          </select>
        </Slot>

        {isCompare && (
          <>
            <SlotLabel>Comparar por</SlotLabel>
            <Slot highlighted={dragOver === "compare"} {...dropHandlers("compare")}>
              <select
                value={compareField?.key ?? ""}
                disabled={fields.length === 0}
                onChange={(e) => {
                  const next = e.target.value || null;
                  onChange((prev) => ({ ...prev, compareBy: next, periodA: null, periodB: null }));
                }}
                style={selectStyle}
                aria-label="Comparar por"
              >
                <option value="">Arrastra o elige una fecha o una fase...</option>
                {compareFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.kind === "date" ? "📅 " : ""}
                    {optionLabel(f)}
                  </option>
                ))}
              </select>
            </Slot>
            {compareField && periods.length > 0 && (
              <>
                <SlotLabel>Periodo A</SlotLabel>
                <PeriodSelect
                  side="A"
                  value={periodA}
                  periods={periods}
                  onChange={(key) => onChange((prev) => ({ ...prev, periodA: key }))}
                />
                <SlotLabel>Periodo B</SlotLabel>
                <PeriodSelect
                  side="B"
                  value={periodB}
                  periods={periods}
                  onChange={(key) => onChange((prev) => ({ ...prev, periodB: key }))}
                />
              </>
            )}
          </>
        )}
      </div>

      {notice && <div style={{ fontSize: 12, color: "#8a1c14" }}>{notice}</div>}

      <div ref={chartArea} style={{ minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {!category ? (
          <Placeholder highlighted={dragOver !== null}>
            {fields.length === 0
              ? "Selecciona uno o varios modelos para ver sus datos."
              : "Arrastra aquí un dato de la lista para construir este gráfico."}
          </Placeholder>
        ) : !datasets ? (
          <Placeholder>Leyendo los datos de los modelos...</Placeholder>
        ) : isCompare && !compareField ? (
          <Placeholder highlighted={dragOver !== null}>
            Elige en “Comparar por” una fecha (se compara mes contra mes) o un dato de texto como la fase o el nivel.
          </Placeholder>
        ) : isCompare && periods.length < 2 ? (
          <Placeholder>
            “{compareField ? fieldLabel(compareField) : ""}” tiene un solo valor en los objetos filtrados: no hay dos
            periodos que comparar.
          </Placeholder>
        ) : !hasRows ? (
          <Placeholder>Ningún objeto de los modelos seleccionados tiene estos datos.</Placeholder>
        ) : tableView ? (
          isCompare ? (
            <CompareTable rows={comparison!.rows} categoryTitle={fieldLabel(category)} labelA={labelA} labelB={labelB} />
          ) : (
            <DataTable
              rows={singleRows}
              categoryTitle={fieldLabel(category)}
              valueTitle={valueTitle}
              activeKey={activeKey}
              onRowClick={(row) => onSelectObjects(row.key, row.members)}
            />
          )
        ) : isCompare ? (
          <CompareChart
            rows={compareRows}
            unitLabel={unitLabel}
            labelA={labelA}
            labelB={labelB}
            activeKey={activeKey}
            onBarClick={(row, side: CompareSide) =>
              onSelectObjects(`${row.key}|${side}`, side === "A" ? row.membersA : row.membersB)
            }
            animate={!exportMode}
          />
        ) : spec.type === "column" ? (
          <ColumnChart
            rows={chartRows}
            unitLabel={unitLabel}
            activeKey={activeKey}
            onRowClick={(r) => onSelectObjects(r.key, r.members)}
            colors={showColors ? rowColors : null}
            animate={!exportMode}
          />
        ) : spec.type === "horizontal" ? (
          <HorizontalBarChart
            rows={chartRows}
            unitLabel={unitLabel}
            activeKey={activeKey}
            onRowClick={(r) => onSelectObjects(r.key, r.members)}
            colors={showColors ? rowColors : null}
            animate={!exportMode}
          />
        ) : (
          <DonutChart
            rows={chartRows}
            unitLabel={unitLabel}
            activeKey={activeKey}
            onRowClick={(r) => onSelectObjects(r.key, r.members)}
            animate={!exportMode}
          />
        )}
      </div>

      {colored && hasRows && !tableView && (spec.type === "column" || spec.type === "horizontal") && (
        <ColorLegend groups={colorGroups} />
      )}
      {colored && hasRows && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          🎨 Los objetos del modelo 3D tienen el mismo color que su categoría en este gráfico.
        </div>
      )}

      {selection && (
        <div style={selectionNoticeStyle}>
          <span>
            ✓ {formatNumber(selection.count)} objetos seleccionados en el visor
          </span>
          <button type="button" onClick={onClearSelection} style={linkButtonStyle}>
            Quitar
          </button>
        </div>
      )}

      {result && hasRows && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          {formatNumber(result.objectsWithData)} de {formatNumber(result.totalObjects)} objetos tienen estos datos
          {isCompare ? " en los periodos elegidos" : ` · ${formatNumber(singleRows.length)} categorías`}
          {folded && !showTable ? (chronological ? " (los meses más antiguos se agrupan)" : " (las menores se agrupan en “Otros”)") : ""}
          {!showTable ? " · Clic en una barra para seleccionar sus objetos en el modelo." : ""}
        </div>
      )}
    </section>
  );
}

/** Color key for bar charts: which category each color stands for, here and in the model. */
function ColorLegend({ groups }: { groups: ColorGroup[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
      {groups.map((g) => (
        <span key={`${g.color}-${g.label}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--tc-gray-700)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color, flexShrink: 0 }} />
          {g.label}
        </span>
      ))}
    </div>
  );
}

function PeriodSelect({
  side,
  value,
  periods,
  onChange,
}: {
  side: CompareSide;
  value: string | undefined;
  periods: { key: string; label: string; objects: number }[];
  onChange: (key: string) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...selectStyle, borderLeft: `4px solid ${side === "A" ? "#2a78d6" : "#eb6834"}` }}
      aria-label={`Periodo ${side}`}
    >
      {periods.map((p) => (
        <option key={p.key} value={p.key}>
          {p.label} ({formatNumber(p.objects)} objetos)
        </option>
      ))}
    </select>
  );
}

function SlotLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tc-gray-500)" }}>{children}</span>;
}

function Slot({
  highlighted,
  children,
  ...handlers
}: {
  highlighted: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...handlers}
      style={{
        borderRadius: 6,
        outline: highlighted ? "2px solid var(--tc-blue-500)" : "none",
        background: highlighted ? "var(--tc-blue-100)" : "transparent",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function Placeholder({ children, highlighted }: { children: React.ReactNode; highlighted?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px dashed ${highlighted ? "var(--tc-blue-500)" : "var(--tc-gray-300)"}`,
        background: highlighted ? "var(--tc-blue-50)" : "transparent",
        borderRadius: 8,
        minHeight: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 16,
        fontSize: 13,
        color: "var(--tc-gray-500)",
      }}
    >
      {children}
    </div>
  );
}

function DataTable({
  rows,
  categoryTitle,
  valueTitle,
  activeKey,
  onRowClick,
}: {
  rows: { key: string; label: string; value: number; objects: number; members: Members }[];
  categoryTitle: string;
  valueTitle: string;
  activeKey: string | null;
  onRowClick: (row: { key: string; members: Members }) => void;
}) {
  const shown = rows.slice(0, TABLE_ROW_LIMIT);
  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--tc-white)" }}>
            <th style={thStyle}>{categoryTitle}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{valueTitle}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Objetos</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr
              key={row.key}
              onClick={() => onRowClick(row)}
              style={{ cursor: "pointer", background: activeKey === row.key ? "var(--tc-blue-100)" : undefined }}
              title="Clic para seleccionar estos objetos en el modelo"
            >
              <td style={{ ...tdStyle, wordBreak: "break-word" }}>{row.label}</td>
              <td style={numericTd}>{formatNumber(row.value)}</td>
              <td style={numericTd}>{formatNumber(row.objects)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", padding: "6px 4px" }}>
          Se muestran las {TABLE_ROW_LIMIT} categorías mayores de {formatNumber(rows.length)}.
        </div>
      )}
    </div>
  );
}

function CompareTable({
  rows,
  categoryTitle,
  labelA,
  labelB,
}: {
  rows: { key: string; label: string; a: number; b: number }[];
  categoryTitle: string;
  labelA: string;
  labelB: string;
}) {
  const shown = rows.slice(0, TABLE_ROW_LIMIT);
  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--tc-white)" }}>
            <th style={thStyle}>{categoryTitle}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{labelA}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{labelB}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Diferencia (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const diff = row.b - row.a;
            return (
              <tr key={row.key}>
                <td style={{ ...tdStyle, wordBreak: "break-word" }}>{row.label}</td>
                <td style={numericTd}>{formatNumber(row.a)}</td>
                <td style={numericTd}>{formatNumber(row.b)}</td>
                <td style={numericTd}>
                  {diff > 0 ? "+" : ""}
                  {formatNumber(diff)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12.5,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
};

const typeSelectStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--tc-blue-700)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  whiteSpace: "nowrap",
};

const colorButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};

const colorButtonActiveStyle: React.CSSProperties = {
  ...colorButtonStyle,
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  border: "1px solid var(--tc-blue-700)",
};

const selectionNoticeStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  color: "var(--tc-blue-900)",
  background: "var(--tc-blue-100)",
  borderRadius: 6,
  padding: "6px 10px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 6px",
  borderBottom: "1px solid var(--tc-gray-300)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
};

const numericTd: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
