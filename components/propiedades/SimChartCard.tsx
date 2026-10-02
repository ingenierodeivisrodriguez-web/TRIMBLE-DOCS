"use client";

import { useMemo } from "react";
import { assignColors } from "../../lib/graficos/colors";
import { aggregate, formatNumber, GENERAL_GROUP, Members, ModelDataset } from "../../lib/graficos/modelData";
import type { GroupField } from "../../lib/propiedades/grouping";
import { progressChart } from "../../lib/propiedades/simulation";
import { ColumnChart, DonutChart, HorizontalBarChart, MAX_COLUMNS, MAX_HORIZONTAL_BARS, MAX_SLICES } from "../graficos/Charts";

export type SimChartType = "column" | "horizontal" | "donut";

export interface SimChartSpec {
  type: SimChartType;
  category: string | null;
  value: string | null;
}

export const SIM_CHART_TYPES: { type: SimChartType; label: string }[] = [
  { type: "column", label: "Barras verticales" },
  { type: "horizontal", label: "Barras horizontales" },
  { type: "donut", label: "Circular" },
];

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
 * position. Categories and scale are those of the whole timeline, so the chart
 * fills up toward its final shape as the simulation advances.
 */
export default function SimChartCard({
  spec,
  onChange,
  fields,
  full,
  shown,
  animate,
  onSelect,
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
}) {
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const numericFields = fields.filter((f) => f.kind === "number");
  const category = spec.category ? byKey.get(spec.category) : undefined;
  const value = spec.value ? byKey.get(spec.value) : undefined;
  const chronological = category?.kind === "date";
  const maxRows = spec.type === "column" ? MAX_COLUMNS : spec.type === "horizontal" ? MAX_HORIZONTAL_BARS : MAX_SLICES;

  // The chart of the whole timeline is computed once; each step only adds what is shown.
  const final = useMemo(
    () => (category ? aggregate(full, { category: category.key, categoryKind: category.kind, value: value?.key ?? null }) : null),
    [full, category, value]
  );
  const chart = useMemo(
    () =>
      category && final
        ? progressChart(final, shown, { category: category.key, categoryKind: category.kind, value: value?.key ?? null }, maxRows)
        : null,
    [final, shown, category, value, maxRows]
  );

  // Pie colors are fixed per category from the final chart, so a slice keeps its color as it grows.
  const sliceColors = useMemo(() => {
    if (!chart) return [];
    const finalSlices = chart.finalRows.filter((r) => r.value > 0);
    const colors = assignColors(finalSlices, { byLabel: !chronological, ring: true });
    const byRow = new Map(finalSlices.map((r, i) => [r.key, colors[i]]));
    return chart.rows.filter((r) => r.value > 0).map((r) => byRow.get(r.key) ?? colors[0]);
  }, [chart, chronological]);

  const unitLabel = value ? (value.unit ?? "") : "objetos";
  const valueTitle = value ? fieldLabel(value) : "Cantidad de objetos";
  const title = category ? `${valueTitle} por ${fieldLabel(category)}` : "Sin datos asignados";
  const anyShown = !!chart && chart.rows.some((r) => r.value > 0);
  const select = (row: { members: Members; label: string; objects: number }) => onSelect(row.members, row.label, row.objects);

  return (
    <section style={cardStyle}>
      <header>
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

      <div style={{ minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {!category || !chart ? (
          <div style={placeholderStyle}>
            {fields.length === 0 ? "Esperando los datos de los modelos..." : "Elige en Categorías un dato para construir este gráfico."}
          </div>
        ) : chart.totalWithData === 0 ? (
          <div style={placeholderStyle}>Ningún elemento con la fecha simulada tiene estos datos.</div>
        ) : spec.type === "donut" ? (
          anyShown ? (
            <DonutChart
              rows={chart.rows}
              unitLabel={unitLabel}
              activeKey={null}
              onRowClick={select}
              colors={sliceColors}
              animate={animate}
            />
          ) : (
            <div style={placeholderStyle}>Aún no aparece ningún elemento con estos datos.</div>
          )
        ) : spec.type === "column" ? (
          <ColumnChart rows={chart.rows} unitLabel={unitLabel} activeKey={null} onRowClick={select} animate={animate} maxValue={chart.maxValue} />
        ) : (
          <HorizontalBarChart
            rows={chart.rows}
            unitLabel={unitLabel}
            activeKey={null}
            onRowClick={select}
            animate={animate}
            maxValue={chart.maxValue}
          />
        )}
      </div>

      {chart && chart.totalWithData > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          {formatNumber(chart.shownWithData)} de {formatNumber(chart.totalWithData)} elementos con estos datos ya aparecieron
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
