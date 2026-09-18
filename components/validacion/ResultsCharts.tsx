"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalysisSummary } from "../../lib/validacion/types";
import Card from "../Card";

const COLORS = {
  conforming: "#1e88d6",
  nonconforming: "#d9822b",
  unclassified: "#a9b6c4",
};

const TOP_ISSUES = 8;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Compact axis label: "Separador entre «A» y «B»" becomes "Sep. A → B". */
function shortLabel(label: string): string {
  const match = /^Separador entre «(.+)» y «(.+)»$/.exec(label);
  return truncate(match ? `Sep. ${match[1]} → ${match[2]}` : label, 30);
}

/**
 * Two clickable charts: the split of files by status (click a slice to jump to
 * that list) and the fields that fail most often (click a bar to filter the
 * non-conforming table by that field).
 */
export default function ResultsCharts({
  summary,
  activeField,
  onSelectStatus,
  onSelectField,
}: {
  summary: AnalysisSummary;
  activeField: string | null;
  onSelectStatus: (status: "nonconforming" | "unclassified") => void;
  onSelectField: (fieldLabel: string | null) => void;
}) {
  const { totals } = summary;
  const slices = [
    { key: "conforming", name: "Conformes", value: totals.conforming },
    { key: "nonconforming", name: "No conformes", value: totals.nonConforming },
    { key: "unclassified", name: "Sin clasificar", value: totals.unclassified },
  ].filter((slice) => slice.value > 0) as {
    key: keyof typeof COLORS;
    name: string;
    value: number;
  }[];

  const issues = summary.issueCounts.slice(0, TOP_ISSUES);
  const percent =
    totals.classified > 0
      ? `${((totals.conforming / totals.classified) * 100).toLocaleString("es", { maximumFractionDigits: 0 })}%`
      : "—";

  return (
    <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      <Card title="Estado de los archivos" flex={1}>
        <div style={{ position: "relative" }}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={98}
                paddingAngle={2}
                onClick={(entry) => {
                  const key = (entry as unknown as { key: string }).key;
                  if (key === "nonconforming" || key === "unclassified") onSelectStatus(key);
                }}
              >
                {slices.map((slice) => (
                  <Cell
                    key={slice.key}
                    fill={COLORS[slice.key]}
                    cursor={slice.key === "conforming" ? "default" : "pointer"}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [`${Number(value).toLocaleString("es")} archivos`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 26, fontWeight: 700, color: "var(--tc-blue-800)" }}>{percent}</span>
            <span style={{ fontSize: 11, color: "var(--tc-gray-500)" }}>cumplimiento</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14, fontSize: 12 }}>
          {slices.map((slice) => (
            <span key={slice.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[slice.key], display: "inline-block" }}
              />
              {slice.name} ({slice.value.toLocaleString("es")})
            </span>
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--tc-gray-500)", marginTop: 8 }}>
          Haz clic en una porción para ver esos archivos.
        </div>
      </Card>

      <Card title="Campos que más fallan" flex={1}>
        {issues.length === 0 ? (
          <div style={{ color: "var(--tc-gray-500)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
            No hay campos con errores. ¡Todo cumple!
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(180, issues.length * 34 + 30)}>
              <BarChart data={issues} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="fieldLabel"
                  width={190}
                  tick={{ fontSize: 11 }}
                  tickFormatter={shortLabel}
                />
                <Tooltip
                  formatter={(value) => [`${Number(value).toLocaleString("es")} archivos`, "Con error en este campo"]}
                  cursor={{ fill: "rgba(30,136,214,0.08)" }}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(entry) => {
                    const label = (entry as unknown as { fieldLabel: string }).fieldLabel;
                    onSelectField(label === activeField ? null : label);
                  }}
                >
                  {issues.map((issue) => (
                    <Cell
                      key={issue.fieldLabel}
                      fill={COLORS.nonconforming}
                      fillOpacity={activeField && activeField !== issue.fieldLabel ? 0.3 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--tc-gray-500)" }}>
              Haz clic en una barra para filtrar la tabla por ese campo.
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
