"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { extLabel } from "../lib/format";
import { GroupedChartData } from "../lib/grouping";

export default function TypeDonutChart({
  data,
  onSliceClick,
}: {
  data: GroupedChartData[];
  onSliceClick: (item: GroupedChartData) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="ext"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          onClick={(entry) => onSliceClick(entry as unknown as GroupedChartData)}
          cursor="pointer"
        >
          {data.map((entry) => (
            <Cell key={entry.ext} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, _name, item) => [
            `${value} archivos`,
            extLabel((item?.payload as GroupedChartData)?.ext ?? "otros"),
          ]}
        />
        <Legend
          formatter={(value) => extLabel(value as string)}
          onClick={(entry) => onSliceClick(entry.payload as unknown as GroupedChartData)}
          wrapperStyle={{ cursor: "pointer", fontSize: 13 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
