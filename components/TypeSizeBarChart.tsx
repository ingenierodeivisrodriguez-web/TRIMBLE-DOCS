"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { extLabel, formatBytes } from "../lib/format";
import { GroupedChartData } from "../lib/grouping";

export default function TypeSizeBarChart({
  data,
  onBarClick,
}: {
  data: GroupedChartData[];
  onBarClick: (item: GroupedChartData) => void;
}) {
  const chartData = data.map((d) => ({ ...d, label: extLabel(d.ext) }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tc-gray-100)" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 12 }} width={70} />
        <Tooltip
          formatter={(value) => formatBytes(Number(value))}
          labelFormatter={(label) => label as string}
        />
        <Bar dataKey="size" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(entry) => onBarClick(entry as unknown as GroupedChartData)}>
          {chartData.map((entry) => (
            <Cell key={entry.ext} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
