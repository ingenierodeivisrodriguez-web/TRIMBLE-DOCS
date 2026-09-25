"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartRow, formatNumber, OTHER_LABEL } from "../../lib/graficos/modelData";

// Single-series bars share one hue; the donut uses the first six slots of the
// validated categorical palette, in fixed order, plus a neutral gray for "Otros".
// MAX_SLICES keeps it at six colored slices at most, so a hue is never reused.
const SERIES_COLOR = "#2a78d6";
const PIE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const OTHER_COLOR = "#a3a8ae";
const GRID_COLOR = "#e6e9ee";
const TICK = { fontSize: 11, fill: "#6b7684" };

export const MAX_COLUMNS = 12;
export const MAX_HORIZONTAL_BARS = 15;
export const MAX_SLICES = 6;

function short(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function RowTooltip({
  active,
  payload,
  unitLabel,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  unitLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--tc-white)",
        border: "1px solid var(--tc-gray-300)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        boxShadow: "var(--tc-shadow)",
        maxWidth: 260,
      }}
    >
      <div style={{ fontWeight: 600, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{row.label}</div>
      <div style={{ color: "var(--tc-gray-700)" }}>
        {formatNumber(row.value)} {unitLabel}
      </div>
      <div style={{ color: "var(--tc-gray-500)" }}>{formatNumber(row.objects)} objetos</div>
    </div>
  );
}

export function ColumnChart({ rows, unitLabel }: { rows: ChartRow[]; unitLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey="label"
          tick={TICK}
          tickFormatter={(v: string) => short(v, 12)}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={64}
          tickLine={false}
          axisLine={{ stroke: GRID_COLOR }}
        />
        <YAxis tick={TICK} tickFormatter={(v: number) => formatNumber(v)} width={56} tickLine={false} axisLine={false} />
        <Tooltip content={<RowTooltip unitLabel={unitLabel} />} cursor={{ fill: "var(--tc-blue-50)" }} />
        <Bar dataKey="value" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarChart({ rows, unitLabel }: { rows: ChartRow[]; unitLabel: string }) {
  const height = Math.max(120, rows.length * 26 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
        <XAxis type="number" tick={TICK} tickFormatter={(v: number) => formatNumber(v)} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={TICK}
          tickFormatter={(v: string) => short(v, 18)}
          width={120}
          interval={0}
          tickLine={false}
          axisLine={{ stroke: GRID_COLOR }}
        />
        <Tooltip content={<RowTooltip unitLabel={unitLabel} />} cursor={{ fill: "var(--tc-blue-50)" }} />
        <Bar dataKey="value" fill={SERIES_COLOR} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ rows, unitLabel }: { rows: ChartRow[]; unitLabel: string }) {
  // A slice can only show a positive share of the whole.
  const slices = rows.filter((r) => r.value > 0);
  let colorIndex = 0;
  const colors = slices.map((r) => (r.label === OTHER_LABEL ? OTHER_COLOR : PIE_COLORS[colorIndex++]));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="label" innerRadius={55} outerRadius={95} paddingAngle={1}>
          {slices.map((row, i) => (
            <Cell key={row.label} fill={colors[i]} stroke="var(--tc-white)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip content={<RowTooltip unitLabel={unitLabel} />} />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: "var(--tc-gray-700)", fontSize: 12 }}>{short(value, 24)}</span>
          )}
          iconType="circle"
          iconSize={9}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
