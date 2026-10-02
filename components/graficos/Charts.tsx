"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { assignColors, CATEGORY_COLORS, COMPARE_COLORS } from "../../lib/graficos/colors";
import { ChartRow, CompareRow, formatNumber } from "../../lib/graficos/modelData";

// Single-series bars share one hue unless "Colorear" is on, when each bar
// takes its category's color (the same one painted on the model). The donut
// always colors by category. Past 8 categories the palette repeats (see assignColors).
const SERIES_COLOR = CATEGORY_COLORS[0];
const GRID_COLOR = "#e6e9ee";
const TICK = { fontSize: 11, fill: "#6b7684" };
// Marks outside the clicked category recede so the selection reads at a glance.
const DIMMED = 0.3;

// Charts show every category up to these limits (scrolling when they don't
// fit the card); only past them do the smallest fold into "Otros".
export const MAX_COLUMNS = 50;
export const MAX_HORIZONTAL_BARS = 100;
export const MAX_SLICES = 50;
export const MAX_COMPARE_GROUPS = 50;
// Room per column (and per A/B pair) before a chart scrolls sideways, and the
// tallest the horizontal chart and the donut's key grow before they scroll down.
// The scrolled content clips its overflow: Recharts rounds the drawing's width
// up, and that fraction of a pixel alone would show a scrollbar.
const COLUMN_WIDTH = 36;
const COMPARE_GROUP_WIDTH = 56;
const HORIZONTAL_MAX_HEIGHT = 620;
const DONUT_KEY_MAX_HEIGHT = 150;

export type CompareSide = "A" | "B";

function short(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function opacity(activeKey: string | null, key: string): number {
  return activeKey && activeKey !== key ? DIMMED : 1;
}

/** Recharts reports the category under the pointer as its index (a number, or a numeric string). */
function rowAt<T>(rows: T[], state: { activeTooltipIndex?: number | string | null } | null | undefined): T | undefined {
  const index = Number(state?.activeTooltipIndex);
  return Number.isInteger(index) ? rows[index] : undefined;
}

const tooltipBox: React.CSSProperties = {
  background: "var(--tc-white)",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  boxShadow: "var(--tc-shadow)",
  maxWidth: 260,
};

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
    <div style={tooltipBox}>
      <div style={{ fontWeight: 600, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{row.label}</div>
      <div style={{ color: "var(--tc-gray-700)" }}>
        {formatNumber(row.value)} {unitLabel}
      </div>
      <div style={{ color: "var(--tc-gray-500)" }}>{formatNumber(row.objects)} objetos · clic para seleccionarlos</div>
    </div>
  );
}

interface SingleSeriesProps {
  rows: ChartRow[];
  unitLabel: string;
  activeKey: string | null;
  onRowClick: (row: ChartRow) => void;
  /** One color per row when "Colorear" is on; otherwise every bar uses the series color. */
  colors?: string[] | null;
  /** Off while exporting, so the captured SVG is the final drawing, not a frame of the animation. */
  animate?: boolean;
}

export function ColumnChart({ rows, unitLabel, activeKey, onRowClick, colors, animate = true }: SingleSeriesProps) {
  return (
    <div style={{ overflowX: "auto", overflowY: "hidden" }}>
      <div style={{ minWidth: rows.length * COLUMN_WIDTH + 64, overflow: "hidden" }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
            onClick={(state) => {
              const row = rowAt(rows, state);
              if (row) onRowClick(row);
            }}
            style={{ cursor: "pointer" }}
          >
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
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={animate}>
              {rows.map((row, i) => (
                <Cell key={row.key} fill={colors?.[i] ?? SERIES_COLOR} fillOpacity={opacity(activeKey, row.key)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HorizontalBarChart({ rows, unitLabel, activeKey, onRowClick, colors, animate = true }: SingleSeriesProps) {
  const height = Math.max(120, rows.length * 26 + 40);
  return (
    <div style={{ maxHeight: HORIZONTAL_MAX_HEIGHT, overflowY: "auto", overflowX: "hidden" }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
          onClick={(state) => {
            const row = rowAt(rows, state);
            if (row) onRowClick(row);
          }}
          style={{ cursor: "pointer" }}
        >
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
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={animate}>
            {rows.map((row, i) => (
              <Cell key={row.key} fill={colors?.[i] ?? SERIES_COLOR} fillOpacity={opacity(activeKey, row.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ rows, unitLabel, activeKey, onRowClick, colors, animate = true }: SingleSeriesProps) {
  // A slice can only show a positive share of the whole. Colors come from the
  // card - the same ones "Colorear" paints on the model.
  const slices = rows.filter((r) => r.value > 0);
  const sliceColors = colors ?? assignColors(slices, { ring: true });
  const total = slices.reduce((sum, r) => sum + r.value, 0);
  // Many thin slices: no gaps, thinner borders, so none disappears.
  const crowded = slices.length > 20;

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={55}
            outerRadius={95}
            paddingAngle={crowded ? 0 : 1}
            onClick={(_, index) => {
              const row = slices[index];
              if (row) onRowClick(row);
            }}
            cursor="pointer"
            isAnimationActive={animate}
          >
            {slices.map((row, i) => (
              <Cell
                key={row.key}
                fill={sliceColors[i]}
                fillOpacity={opacity(activeKey, row.key)}
                stroke="#ffffff"
                strokeWidth={crowded ? 1 : 2}
              />
            ))}
          </Pie>
          <Tooltip content={<RowTooltip unitLabel={unitLabel} />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Key in slice order (clockwise from the top); a click selects like the slice does. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "2px 10px",
          maxHeight: DONUT_KEY_MAX_HEIGHT,
          overflowY: "auto",
        }}
      >
        {slices.map((row, i) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onRowClick(row)}
            title={`${row.label}: ${formatNumber(row.value)} ${unitLabel}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              border: "none",
              background: "transparent",
              padding: "1px 0",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              color: "var(--tc-gray-700)",
              opacity: opacity(activeKey, row.key),
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: sliceColors[i], flexShrink: 0 }} />
            {short(row.label, 24)}
            <span style={{ color: "var(--tc-gray-500)" }}>{formatNumber(total ? (row.value / total) * 100 : 0)} %</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CompareTooltip({
  active,
  payload,
  unitLabel,
  labelA,
  labelB,
}: {
  active?: boolean;
  payload?: { payload: CompareRow }[];
  unitLabel: string;
  labelA: string;
  labelB: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const diff = row.b - row.a;
  return (
    <div style={tooltipBox}>
      <div style={{ fontWeight: 600, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{row.label}</div>
      <div style={{ color: "var(--tc-gray-700)" }}>
        {labelA}: {formatNumber(row.a)} {unitLabel}
      </div>
      <div style={{ color: "var(--tc-gray-700)" }}>
        {labelB}: {formatNumber(row.b)} {unitLabel}
      </div>
      <div style={{ color: "var(--tc-gray-500)" }}>
        Diferencia: {diff > 0 ? "+" : ""}
        {formatNumber(diff)} {unitLabel}
      </div>
    </div>
  );
}

export function CompareChart({
  rows,
  unitLabel,
  labelA,
  labelB,
  activeKey,
  onBarClick,
  animate = true,
}: {
  rows: CompareRow[];
  unitLabel: string;
  labelA: string;
  labelB: string;
  /** "<row key>|A" or "<row key>|B" */
  activeKey: string | null;
  onBarClick: (row: CompareRow, side: CompareSide) => void;
  animate?: boolean;
}) {
  return (
    <div>
      <div style={{ overflowX: "auto", overflowY: "hidden" }}>
        <div style={{ minWidth: rows.length * COMPARE_GROUP_WIDTH + 64, overflow: "hidden" }}>
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={2} barCategoryGap="22%">
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
              <Tooltip
                content={<CompareTooltip unitLabel={unitLabel} labelA={labelA} labelB={labelB} />}
                cursor={{ fill: "var(--tc-blue-50)" }}
              />
              {(["A", "B"] as const).map((side) => (
                <Bar
                  key={side}
                  dataKey={side === "A" ? "a" : "b"}
                  name={side === "A" ? labelA : labelB}
                  fill={COMPARE_COLORS[side]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  cursor="pointer"
                  isAnimationActive={animate}
                  onClick={(_, index) => {
                    const row = rows[index];
                    if (row) onBarClick(row, side);
                  }}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={COMPARE_COLORS[side]}
                      fillOpacity={opacity(activeKey, `${row.key}|${side}`)}
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 12, color: "var(--tc-gray-700)" }}>
        {(["A", "B"] as const).map((side) => (
          <span key={side} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: COMPARE_COLORS[side] }} />
            {side === "A" ? labelA : labelB}
          </span>
        ))}
      </div>
    </div>
  );
}
