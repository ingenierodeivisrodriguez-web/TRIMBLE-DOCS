"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DuplicatesSummary } from "../../lib/validacion/types";
import Card from "../Card";

const COLOR = "#d9822b";
const TOP_EXTENSIONS = 8;

/** Bar chart of which extensions show up most often among duplicate-name files; click a bar to filter the list. */
export default function DuplicatesChart({
  summary,
  activeExt,
  onSelectExt,
}: {
  summary: DuplicatesSummary;
  activeExt: string | null;
  onSelectExt: (ext: string | null) => void;
}) {
  const data = summary.byExt.slice(0, TOP_EXTENSIONS).map((e) => ({
    ext: e.ext === "sin-extension" ? "(sin extensión)" : `.${e.ext}`,
    key: e.ext,
    count: e.count,
  }));

  return (
    <Card title="Extensiones con más duplicados" flex={1}>
      {data.length === 0 ? (
        <div style={{ color: "var(--tc-gray-500)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          No se encontraron nombres duplicados.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 30)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="ext" width={110} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => [`${Number(value).toLocaleString("es")} archivos`, "Duplicados"]}
                cursor={{ fill: "rgba(217,130,43,0.08)" }}
              />
              <Bar
                dataKey="count"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(entry) => {
                  const key = (entry as unknown as { key: string }).key;
                  onSelectExt(key === activeExt ? null : key);
                }}
              >
                {data.map((row) => (
                  <Cell key={row.key} fill={COLOR} fillOpacity={activeExt && activeExt !== row.key ? 0.3 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--tc-gray-500)" }}>
            Haz clic en una barra para filtrar la lista por esa extensión.
          </div>
        </>
      )}
    </Card>
  );
}
