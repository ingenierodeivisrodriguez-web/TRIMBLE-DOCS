import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChartReportData, chartInsights, reportTable } from "./insights";
import { OTHER_KEY } from "./modelData";

function single(rows: [string, number, number][], extra: Partial<ChartReportData> = {}): ChartReportData {
  return {
    typeLabel: "Barras verticales",
    title: "Weight (kg) por Tipo",
    categoryTitle: "Tipo",
    valueTitle: "Weight (kg)",
    valueName: "Weight",
    unit: "kg",
    chronological: false,
    coverage: { withData: 320, total: 320 },
    single: {
      rows: rows.map(([label, value, objects]) => ({
        key: label === "Otros" ? OTHER_KEY : label,
        label,
        value,
        objects,
        color: "#2a78d6",
      })),
    },
    ...extra,
  };
}

describe("chartInsights", () => {
  it("names the leading category and its share", () => {
    const [first] = chartInsights(single([["HEA120", 600, 10], ["HEA200", 300, 5], ["IPE160", 100, 2]]));
    assert.equal(first, "HEA120 es la categoría principal, con 600 kg: el 60 % del total de Weight.");
  });

  it("reports how concentrated the top 3 are when there are enough categories", () => {
    const findings = chartInsights(single([["A", 50, 1], ["B", 20, 1], ["C", 10, 1], ["D", 10, 1], ["E", 10, 1]]));
    assert.ok(findings.includes("Las 3 categorías principales concentran el 80 % del total."));
  });

  it("doesn't crown a leader when categories tie", () => {
    const [allEqual] = chartInsights(single([["A", 64, 64], ["B", 64, 64], ["C", 64, 64]], { valueName: null, unit: "objetos" }));
    assert.equal(allEqual, "Las 3 categorías tienen el mismo valor: 64 objetos cada una.");
    const [tie] = chartInsights(single([["A", 40, 1], ["B", 40, 1], ["C", 20, 1]]));
    assert.equal(tie, "2 categorías comparten el primer lugar, con 40 kg cada una (40 % del total de Weight cada una).");
  });

  it("speaks of objects when the chart counts them", () => {
    const [first] = chartInsights(single([["Montado", 3, 3], ["Pintura", 1, 1]], { valueName: null, unit: "objetos" }));
    assert.equal(first, "Montado es la categoría principal, con 3 objetos: el 75 % de los objetos.");
  });

  it("mentions missing data only when some objects lack it", () => {
    const findings = chartInsights(single([["A", 1, 1], ["B", 1, 1]], { coverage: { withData: 80, total: 100 } }));
    assert.equal(findings.at(-1), "2 categorías en 2 objetos (80 % de los objetos analizados tienen este dato).");
  });

  it("describes a trend for months", () => {
    const findings = chartInsights(
      single([["ene 2026", 100, 1], ["feb 2026", 300, 1], ["mar 2026", 150, 1]], { chronological: true })
    );
    assert.deepEqual(findings, [
      "El mes con mayor Weight fue feb 2026 (300 kg).",
      "Entre ene 2026 y mar 2026 pasó de 100 kg a 150 kg (+50 %).",
      "Promedio mensual: 183,33 kg en 3 meses.",
    ]);
  });

  it("compares totals and names the biggest changes", () => {
    const findings = chartInsights({
      ...single([]),
      single: undefined,
      compare: {
        labelA: "abr 2026",
        labelB: "may 2026",
        rows: [
          { label: "HEA120", a: 100, b: 250 },
          { label: "HEA200", a: 80, b: 20 },
          { label: "L80*8", a: 0, b: 30 },
        ],
      },
    });
    assert.deepEqual(findings, [
      "may 2026 suma 300 kg frente a 180 kg en abr 2026 (+66,7 %).",
      "Mayor aumento: HEA120 (+150 kg).",
      "Mayor disminución: HEA200 (-60 kg).",
      "1 categoría solo aparece en may 2026.",
    ]);
  });
});

describe("reportTable", () => {
  it("adds the share of the total and a totals row", () => {
    const table = reportTable(single([["HEA120", 750, 3], ["HEA200", 250, 1]]));
    assert.deepEqual(table.columns, ["Tipo", "Weight (kg)", "% del total", "Objetos"]);
    assert.deepEqual(table.rows[0].cells, ["HEA120", "750", "75 %", "3"]);
    assert.equal(table.rows[0].color, "#2a78d6");
    assert.deepEqual(table.total, ["Total", "1.000", "100 %", "4"]);
  });

  it("shows difference and change for comparisons", () => {
    const table = reportTable({
      ...single([]),
      single: undefined,
      compare: {
        labelA: "A: abr",
        labelB: "B: may",
        rows: [
          { label: "HEA120", a: 100, b: 150 },
          { label: "L80*8", a: 0, b: 30 },
        ],
      },
    });
    assert.deepEqual(table.rows.map((r) => r.cells), [
      ["HEA120", "100", "150", "+50", "+50 %"],
      ["L80*8", "0", "30", "+30", "Nuevo"],
    ]);
    assert.deepEqual(table.total, ["Total", "100", "180", "+80", "+80 %"]);
  });
});
