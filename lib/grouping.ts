import { TypeAggregate } from "./types";

export const CHART_PALETTE = [
  "#0b5fa5",
  "#1e88d6",
  "#3fa9dc",
  "#0a3d62",
  "#5cb8e4",
  "#0a4f8c",
  "#7cc4ea",
  "#124a7a",
];
export const OTHERS_COLOR = "#a9b6c4";

export interface GroupedChartData extends TypeAggregate {
  color: string;
  isOthers: boolean;
}

export function groupTopN(
  items: TypeAggregate[],
  metric: "count" | "size",
  topN: number
): { chartData: GroupedChartData[]; othersItems: TypeAggregate[] } {
  const sorted = [...items].sort((a, b) => b[metric] - a[metric]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);

  const chartData: GroupedChartData[] = top.map((item, i) => ({
    ...item,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
    isOthers: false,
  }));

  if (rest.length > 0) {
    chartData.push({
      ext: "otros",
      count: rest.reduce((sum, r) => sum + r.count, 0),
      size: rest.reduce((sum, r) => sum + r.size, 0),
      color: OTHERS_COLOR,
      isOthers: true,
    });
  }

  return { chartData, othersItems: rest.sort((a, b) => b[metric] - a[metric]) };
}
