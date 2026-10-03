"use client";

import { useEffect, useMemo } from "react";
import { assignColors, ColorGroup } from "../../lib/graficos/colors";
import { aggregate, applySlicers, formatNumber, GENERAL_GROUP, Members, ModelDataset, SlicerSpec } from "../../lib/graficos/modelData";
import type { GroupField } from "../../lib/propiedades/grouping";
import { progressChart } from "../../lib/propiedades/simulation";
import { ColumnChart, DonutChart, HorizontalBarChart, MAX_COLUMNS, MAX_HORIZONTAL_BARS, MAX_SLICES } from "../graficos/Charts";
import SimSlicers from "./SimSlicers";

export type SimChartType = "column" | "horizontal" | "donut";

export interface SimChartSpec {
  type: SimChartType;
  category: string | null;
  value: string | null;
  /** This chart's own slicers (absent in configurations saved before they existed). */
  slicers?: SlicerSpec[];
}

export const SIM_CHART_TYPES: { type: SimChartType; label: string }[] = [
  { type: "column", label: "Barras verticales" },
  { type: "horizontal", label: "Barras horizontales" },
  { type: "donut", label: "Circular" },
];

/** Categories named in the color key before "y N más". */
const LEGEND_LABELS = 12;

function fieldLabel(field: GroupField): string {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

function optionLabel(field: GroupField): string {
  if (field.fromApp) return `${fieldLabel(field)} — atributo del proyecto`;
  return field.group === GENERAL_GROUP ? fieldLabel(field) : `${fieldLabel(field)} — ${field.group}`;
}

/**
 * A chart of the Simulador, like the ones of Gráficos de Modelos (same chart
 * types and look), built from the elements already shown at the timeline's
 * position. Categories, scale and colors are those of the whole timeline, so
 * the chart fills up toward its final shape as the simulation advances. With
 * "Colorear", the model takes the chart's colors as elements appear.
 */
export default function SimChartCard({
  spec,
  onChange,
  fields,
  full,
  shown,
  animate,
  onSelect,
  colored,
  onToggleColors,
  onColorGroups,
  before,
  periodLabel,
}: {
  spec: SimChartSpec;
  onChange: (spec: SimChartSpec) => void;
  /** Every field of the models (charts can use any of them, not only the simulated date). */
  fields: GroupField[];
  /** Every element with the simulated date. */
  full: ModelDataset[];
  /** The elements already shown at the current position. */
  shown: ModelDataset[];
  /** Off while playing, so the bars follow the timeline instead of re-animating every step. */
  animate: boolean;
  onSelect: (members: Members, label: string, objects: number) => void;
  /** This chart is the one painting the model. */
  colored: boolean;
  onToggleColors: () => void;
  /** While colored: the chart's categories (all their elements in the timeline) with their colors. */
  onColorGroups: (groups: ColorGroup[]) => void;
  /** The elements shown before the current day / week / month: the rest is that period's progress. */
  before: ModelDataset[] | null;
  /** How that period reads, e.g. "el 05-03-2026" or "esta semana". */
  periodLabel: string;
}) {
  const slicers = useMemo(() => spec.slicers ?? [], [spec.slicers]);
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const numericFields = fields.filter((f) => f.kind === "number");
  const category = spec.category ? byKey.get(spec.category) : undefined;
  const value = spec.value ? byKey.get(spec.value) : undefined;
  const chronological = category?.kind === "date";
  const maxRows = spec.type === "column" ? MAX_COLUMNS : spec.type === "horizontal" ? MAX_HORIZONTAL_BARS : MAX_SLICES;

  // This chart's slicers filter both the whole timeline and what has appeared.
  const fullSliced = useMemo(() => applySlicers(full, slicers), [full, slicers]);
  const shownSliced = useMemo(() => applySlicers(shown, slicers), [shown, slicers]);

  // The chart of the whole timeline is computed once; each step only adds what is shown.
  const final = useMemo(
    () => (category ? aggregate(fullSliced, { category: category.key, categoryKind: category.kind, value: value?.key ?? null }) : null),
    [fullSliced, category, value]
  );
  const chart = useMemo(
    () =>
      category && final
        ? progressChart(final, shownSliced, { category: category.key, categoryKind: category.kind, value: value?.key ?? null }, maxRows)
        : null,
    [final, shownSliced, category, value, maxRows]
  );

  // What the current period added to each bar: drawn in orange on top of what was there before.
  const beforeSliced = useMemo(() => (before ? applySlicers(before, slicers) : null), [before, slicers]);
  const increments = useMemo(() => {
    if (!chart || !final || !category || !beforeSliced) return null;
    const previous = progressChart(final, beforeSliced, { category: category.key, categoryKind: category.kind, value: value?.key ?? null }, maxRows);
    return chart.rows.map((row, i) => Math.max(0, row.value - (previous.rows[i]?.value ?? 0)));
  }, [chart, final, beforeSliced, category, value, maxRows]);
  const added = useMemo(
    () =>
      chart && increments
        ? chart.rows
            .map((row, i) => ({ label: row.label, value: increments[i] }))
            .filter((r) => r.value > 0)
            .sort((a, b) => b.value - a.value)
        : [],
    [chart, increments]
  );
  const addedTotal = added.reduce((sum, r) => sum + r.value, 0);

  // Colors are fixed per category from the final chart, so a bar or slice keeps its color as it grows.
  const colorByKey = useMemo(() => {
    if (!chart) return new Map<string, string>();
    const colorable = spec.type === "donut" ? chart.finalRows.filter((r) => r.value > 0) : chart.finalRows;
    const colors = assignColors(colorable, spec.type === "donut" ? { byLabel: !chronological, ring: true } : { byLabel: !chronological });
    return new Map(colorable.map((r, i) => [r.key, colors[i]]));
  }, [chart, spec.type, chronological]);

  const barColors = useMemo(
    () => (colored && chart ? chart.rows.map((r) => colorByKey.get(r.key) ?? "#9aa3ad") : null),
    [colored, chart, colorByKey]
  );
  const sliceColors = useMemo(
    () => (chart ? chart.rows.filter((r) => r.value > 0).map((r) => colorByKey.get(r.key) ?? "#9aa3ad") : []),
    [chart, colorByKey]
  );

  // What "Colorear" paints in the model: each category's elements in its color.
  const colorGroups = useMemo<ColorGroup[]>(
    () =>
      chart
        ? chart.finalRows
            .filter((r) => colorByKey.has(r.key))
            .map((r) => ({ color: colorByKey.get(r.key)!, label: r.label, members: r.members }))
        : [],
    [chart, colorByKey]
  );
  // Only the categories decide the colors, not the step of the timeline.
  const colorSignature = colorGroups.map((g) => `${g.color}:${g.label}:${Object.values(g.members).reduce((n, ids) => n + ids.length, 0)}`).join("|");
  useEffect(() => {
    if (colored) onColorGroups(colorGroups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colored, colorSignature, onColorGroups]);

  const unitLabel = value ? (value.unit ?? "") : "objetos";
  const valueTitle = value ? fieldLabel(value) : "Cantidad de objetos";
  const title = category ? `${valueTitle} por ${fieldLabel(category)}` : "Sin datos asignados";
  const anyShown = !!chart && chart.rows.some((r) => r.value > 0);
  const select = (row: { members: Members; label: string; objects: number }) => onSelect(row.members, row.label, row.objects);
  const filtered = slicers.some((s) => s.selected !== null);

  return (
    <section style={cardStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <select
            value={spec.type}
            onChange={(e) => onChange({ ...spec, type: e.target.value as SimChartType })}
            style={typeSelectStyle}
            aria-label="Tipo de gráfico"
          >
            {SIM_CHART_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <h3 style={{ margin: "4px 0 0", fontSize: 14.5, color: "var(--tc-blue-800)", wordBreak: "break-word" }}>{title}</h3>
        </div>
        {chart && chart.totalWithData > 0 && (
          <button
            type="button"
            onClick={onToggleColors}
            style={colored ? colorButtonActiveStyle : colorButtonStyle}
            aria-pressed={colored}
            title="Pinta cada categoría con su color en el gráfico y en el modelo 3D, a medida que los elementos aparecen"
          >
            {colored ? "✓ Coloreado" : "🎨 Colorear"}
          </button>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center" }}>
        <span style={slotLabelStyle}>Categorías</span>
        <select
          value={category?.key ?? ""}
          disabled={fields.length === 0}
          onChange={(e) => onChange({ ...spec, category: e.target.value || null })}
          style={selectStyle}
          aria-label="Categorías"
        >
          <option value="">Elige un dato...</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {optionLabel(f)}
            </option>
          ))}
        </select>
        <span style={slotLabelStyle}>Valor</span>
        <select
          value={value?.key ?? ""}
          disabled={fields.length === 0}
          onChange={(e) => onChange({ ...spec, value: e.target.value || null })}
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
      </div>

      <SimSlicers fields={fields} datasets={full} slicers={slicers} onChange={(next) => onChange({ ...spec, slicers: next })} />

      <div style={{ minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {!category || !chart ? (
          <div style={placeholderStyle}>
            {fields.length === 0 ? "Esperando los datos de los modelos..." : "Elige en Categorías un dato para construir este gráfico."}
          </div>
        ) : chart.totalWithData === 0 ? (
          <div style={placeholderStyle}>
            {filtered ? "Ningún elemento pasa los segmentadores de este gráfico." : "Ningún elemento con la fecha simulada tiene estos datos."}
          </div>
        ) : spec.type === "donut" ? (
          anyShown ? (
            <DonutChart rows={chart.rows} unitLabel={unitLabel} activeKey={null} onRowClick={select} colors={sliceColors} animate={animate} />
          ) : (
            <div style={placeholderStyle}>Aún no aparece ningún elemento con estos datos.</div>
          )
        ) : spec.type === "column" ? (
          <ColumnChart
            rows={chart.rows}
            unitLabel={unitLabel}
            activeKey={null}
            onRowClick={select}
            colors={barColors}
            animate={animate}
            maxValue={chart.maxValue}
            increments={increments}
            incrementLabel={periodLabel}
          />
        ) : (
          <HorizontalBarChart
            rows={chart.rows}
            unitLabel={unitLabel}
            activeKey={null}
            onRowClick={select}
            colors={barColors}
            animate={animate}
            maxValue={chart.maxValue}
            increments={increments}
            incrementLabel={periodLabel}
          />
        )}
      </div>

      {chart && chart.totalWithData > 0 && increments && (
        <div style={periodLineStyle}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#eb6834", flexShrink: 0, marginTop: 3 }} />
          <span>
            {added.length === 0 ? (
              <>Sin avance {periodLabel} en este gráfico.</>
            ) : (
              <>
                <strong>
                  Avance {periodLabel}: +{formatNumber(addedTotal)} {value ? unitLabel : addedTotal === 1 ? "objeto" : "objetos"}
                </strong>
                {" · "}
                {added
                  .slice(0, 6)
                  .map((r) => `${r.label} +${formatNumber(r.value)}`)
                  .join(" · ")}
                {added.length > 6 ? ` · y ${added.length - 6} más` : ""}
              </>
            )}
          </span>
        </div>
      )}

      {colored && chart && chart.totalWithData > 0 && spec.type !== "donut" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {colorGroups.slice(0, LEGEND_LABELS).map((g) => (
            <span key={g.label} style={legendItemStyle} title={g.label}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
            </span>
          ))}
          {colorGroups.length > LEGEND_LABELS && (
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>y {colorGroups.length - LEGEND_LABELS} más</span>
          )}
        </div>
      )}
      {colored && chart && chart.totalWithData > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          🎨 En el modelo, cada elemento toma el color de su categoría al aparecer
          {filtered ? "; los que no pasan los segmentadores conservan su color" : ""}.
        </div>
      )}

      {chart && chart.totalWithData > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          {formatNumber(chart.shownWithData)} de {formatNumber(chart.totalWithData)} elementos con estos datos ya aparecieron
          {filtered ? " (segmentado)" : ""}
          {anyShown ? " · Clic en una barra para seleccionar sus elementos en el modelo." : ""}
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--tc-white)",
  borderRadius: "var(--tc-radius)",
  boxShadow: "var(--tc-shadow)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
};
const typeSelectStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  padding: 0,
  cursor: "pointer",
  fontFamily: "inherit",
};
const slotLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--tc-gray-500)" };
const selectStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
  minWidth: 0,
  width: "100%",
};
const placeholderStyle: React.CSSProperties = {
  border: "1px dashed var(--tc-gray-300)",
  borderRadius: 8,
  padding: 24,
  textAlign: "center",
  fontSize: 13,
  color: "var(--tc-gray-500)",
  minHeight: 160,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const colorButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 999,
  padding: "4px 10px",
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
  borderColor: "var(--tc-blue-600)",
};
const periodLineStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  fontSize: 12,
  color: "var(--tc-gray-700)",
  lineHeight: 1.4,
};
const legendItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  color: "var(--tc-gray-700)",
  maxWidth: 160,
};
