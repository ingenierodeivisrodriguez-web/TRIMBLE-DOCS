// Executive findings and report tables, computed from a chart's data. Pure:
// no DOM, no PDF - the report builder only lays out what comes out of here.
import { formatNumber, OTHER_KEY } from "./modelData";

export interface SingleRow {
  key: string;
  label: string;
  value: number;
  objects: number;
  color: string;
}

export interface CompareRowData {
  label: string;
  a: number;
  b: number;
}

/** A chart's data as the report needs it (no screen elements). */
export interface ChartReportData {
  typeLabel: string;
  title: string;
  categoryTitle: string;
  /** "Weight (kg)" or "Cantidad de objetos". */
  valueTitle: string;
  /** The summed field's name ("Weight"), or null when the chart counts objects. */
  valueName: string | null;
  /** "kg", "m³"... "objetos" when counting, "" for unitless numbers. */
  unit: string;
  chronological: boolean;
  coverage: { withData: number; total: number };
  single?: { rows: SingleRow[] };
  compare?: { labelA: string; labelB: string; rows: CompareRowData[] };
}

export interface ReportTable {
  columns: string[];
  rows: { cells: string[]; color?: string }[];
  total: string[];
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toLocaleString("es", { maximumFractionDigits: 1 })} %`;
}

function signedPercent(fraction: number): string {
  return `${fraction > 0 ? "+" : ""}${percent(fraction)}`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function amount(value: number, unit: string): string {
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

function whatIsMeasured(data: ChartReportData): string {
  return data.valueName ? `del total de ${data.valueName}` : "de los objetos";
}

/** Two to four plain-language findings for the executive summary and the chart's section. */
export function chartInsights(data: ChartReportData): string[] {
  if (data.compare) return compareInsights(data, data.compare);
  const rows = data.single?.rows ?? [];
  if (rows.length === 0) return [];
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const objects = rows.reduce((sum, r) => sum + r.objects, 0);
  const { unit } = data;
  const findings: string[] = [];

  if (data.chronological) {
    const months = rows.filter((r) => r.key !== OTHER_KEY);
    const peak = months.reduce((best, r) => (r.value > best.value ? r : best), months[0]);
    findings.push(
      `El mes con mayor ${data.valueName ?? "cantidad de objetos"} fue ${peak.label} (${amount(peak.value, unit)}).`
    );
    const first = months[0];
    const last = months[months.length - 1];
    if (months.length > 1 && first.value > 0) {
      findings.push(
        `Entre ${first.label} y ${last.label} pasó de ${amount(first.value, unit)} a ${amount(last.value, unit)} (${signedPercent((last.value - first.value) / first.value)}).`
      );
    }
    findings.push(`Promedio mensual: ${amount(total / rows.length, unit)} en ${rows.length} meses.`);
    return findings;
  }

  const categories = rows.filter((r) => r.key !== OTHER_KEY);
  const top = categories[0] ?? rows[0];
  const tied = categories.filter((r) => r.value === top.value).length;
  const allEqual = tied === categories.length && categories.length > 1;
  if (rows.length === 1) {
    findings.push(`${top.label} reúne el total: ${amount(total, unit)} en ${formatNumber(objects)} objetos.`);
  } else if (allEqual) {
    findings.push(`Las ${categories.length} categorías tienen el mismo valor: ${amount(top.value, unit)} cada una.`);
  } else if (tied > 1 && total > 0) {
    findings.push(
      `${tied} categorías comparten el primer lugar, con ${amount(top.value, unit)} cada una (${percent(top.value / total)} ${whatIsMeasured(data)} cada una).`
    );
  } else if (total > 0) {
    findings.push(
      `${top.label} es la categoría principal, con ${amount(top.value, unit)}: el ${percent(top.value / total)} ${whatIsMeasured(data)}.`
    );
  }
  if (categories.length >= 4 && total > 0 && !allEqual) {
    const top3 = categories.slice(0, 3).reduce((sum, r) => sum + r.value, 0);
    findings.push(`Las 3 categorías principales concentran el ${percent(top3 / total)} del total.`);
  }
  const { withData, total: analyzed } = data.coverage;
  findings.push(
    `${formatNumber(rows.length)} categorías en ${formatNumber(objects)} objetos` +
      (withData < analyzed ? ` (${percent(withData / analyzed)} de los objetos analizados tienen este dato).` : ".")
  );
  return findings;
}

function compareInsights(data: ChartReportData, compare: NonNullable<ChartReportData["compare"]>): string[] {
  const { unit } = data;
  const totalA = compare.rows.reduce((sum, r) => sum + r.a, 0);
  const totalB = compare.rows.reduce((sum, r) => sum + r.b, 0);
  const findings = [
    `${compare.labelB} suma ${amount(totalB, unit)} frente a ${amount(totalA, unit)} en ${compare.labelA}` +
      (totalA > 0 ? ` (${signedPercent((totalB - totalA) / totalA)}).` : "."),
  ];
  const byDiff = [...compare.rows].sort((x, y) => y.b - y.a - (x.b - x.a));
  const up = byDiff[0];
  const down = byDiff[byDiff.length - 1];
  if (up && up.b - up.a > 0) findings.push(`Mayor aumento: ${up.label} (${signed(up.b - up.a)}${unit ? ` ${unit}` : ""}).`);
  if (down && down.b - down.a < 0) {
    findings.push(`Mayor disminución: ${down.label} (${signed(down.b - down.a)}${unit ? ` ${unit}` : ""}).`);
  }
  const onlyB = compare.rows.filter((r) => r.a === 0 && r.b > 0).length;
  if (onlyB > 0) findings.push(`${onlyB} categoría${onlyB === 1 ? "" : "s"} solo aparece${onlyB === 1 ? "" : "n"} en ${compare.labelB}.`);
  return findings;
}

/** The chart's data table, with share of total (or change) and a totals row. */
export function reportTable(data: ChartReportData): ReportTable {
  if (data.compare) {
    const { labelA, labelB, rows } = data.compare;
    const totalA = rows.reduce((sum, r) => sum + r.a, 0);
    const totalB = rows.reduce((sum, r) => sum + r.b, 0);
    const change = (a: number, b: number) => (a > 0 ? signedPercent((b - a) / a) : b > 0 ? "Nuevo" : "-");
    return {
      columns: [data.categoryTitle, labelA, labelB, "Diferencia", "Variación"],
      rows: rows.map((r) => ({ cells: [r.label, formatNumber(r.a), formatNumber(r.b), signed(r.b - r.a), change(r.a, r.b)] })),
      total: ["Total", formatNumber(totalA), formatNumber(totalB), signed(totalB - totalA), change(totalA, totalB)],
    };
  }
  const rows = data.single?.rows ?? [];
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const objects = rows.reduce((sum, r) => sum + r.objects, 0);
  return {
    columns: [data.categoryTitle, data.valueTitle, "% del total", "Objetos"],
    rows: rows.map((r) => ({
      cells: [r.label, formatNumber(r.value), total > 0 ? percent(r.value / total) : "-", formatNumber(r.objects)],
      color: r.color,
    })),
    total: ["Total", formatNumber(total), total > 0 ? "100 %" : "-", formatNumber(objects)],
  };
}
