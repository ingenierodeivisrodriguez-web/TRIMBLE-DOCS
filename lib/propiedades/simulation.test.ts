import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregate, applySlicers, Field, ModelDataset } from "../graficos/modelData";
import {
  buildTimeline,
  countUpTo,
  dailyBars,
  datedDatasets,
  dayNumber,
  excludedMembers,
  isoFromDay,
  memberCount,
  membersOf,
  periodBars,
  periodEndOf,
  periodProgress,
  periodStartOf,
  progressChart,
  progressCurve,
  progressPercent,
  shownDatasets,
} from "./simulation";

const FECHA: Field = { key: "prop:a2", label: "semana de instalacion", group: "programacion", kind: "date" };

function dataset(modelId: string, records: [number, string | undefined][]): ModelDataset {
  return {
    modelId,
    modelName: modelId,
    fields: new Map([[FECHA.key, FECHA]]),
    coverage: new Map(),
    records: records.map(([runtimeId, date]) => ({ runtimeId, values: date ? { [FECHA.key]: date } : {} })),
  };
}

const est = dataset("est", [
  [1, "2026-01-10"],
  [2, "2026-03-01"],
  [3, undefined],
  [4, "2026-01-10T08:00:00Z"],
]);
const arq = dataset("arq", [
  [7, "2026-02-15"],
  [8, "no es fecha"],
]);

describe("fechas", () => {
  it("convierte entre fecha ISO y número de día", () => {
    const d = dayNumber("2026-05-20")!;
    assert.equal(isoFromDay(d), "2026-05-20");
    assert.equal(dayNumber("2026-05-20T23:59:00Z"), d);
    assert.equal(dayNumber("2026-05-21")! - d, 1);
    assert.equal(dayNumber("20-05-2026"), null);
    assert.equal(dayNumber(42), null);
  });
});

describe("línea de tiempo", () => {
  const t = buildTimeline([est, arq], FECHA.key);

  it("ordena los elementos con fecha y separa los que no la tienen", () => {
    assert.deepEqual(t.items.map((i) => i.runtimeId), [1, 4, 7, 2]);
    assert.equal(isoFromDay(t.start!), "2026-01-10");
    assert.equal(isoFromDay(t.end!), "2026-03-01");
    assert.deepEqual(t.undated, { est: [3], arq: [8] });
    assert.equal(t.undatedCount, 2);
  });

  it("cuenta los elementos hasta una fecha y calcula el % de avance", () => {
    assert.equal(countUpTo(t.items, dayNumber("2026-01-09")!), 0);
    assert.equal(countUpTo(t.items, dayNumber("2026-01-10")!), 2);
    assert.equal(countUpTo(t.items, dayNumber("2026-02-20")!), 3);
    assert.equal(countUpTo(t.items, t.end!), 4);
    assert.equal(progressPercent(3, 4), 75);
    assert.equal(progressPercent(0, 0), 0);
  });

  it("entrega los elementos de un tramo por modelo, listos para el visor", () => {
    const m = membersOf(t.items, 1, 3);
    assert.deepEqual(m, { est: [4], arq: [7] });
    assert.equal(memberCount(m), 2);
    assert.deepEqual(membersOf(t.items, 3, 99), { est: [2] });
  });

  it("dibuja la curva de avance acumulado de 0 a 100", () => {
    const curve = progressCurve(t.items, t.start!, t.end!, 10);
    assert.equal(curve.length, 11);
    assert.equal(curve[0], 50); // two elements on the first day
    assert.equal(curve[10], 100);
    assert.ok(curve.every((v, i) => i === 0 || v >= curve[i - 1]), "nunca baja");
  });

  it("sin elementos con fecha no hay línea de tiempo", () => {
    const empty = buildTimeline([dataset("x", [[1, undefined]])], FECHA.key);
    assert.equal(empty.start, null);
    assert.deepEqual(progressCurve(empty.items, 0, 0), []);
  });
});

describe("gráficos del avance", () => {
  const TIPO: Field = { key: "@objectType", label: "Tipo", group: "General", kind: "text" };
  const AREA: Field = { key: "Dimensions · Area", label: "Area", group: "Dimensions", kind: "number" };
  const ds: ModelDataset = {
    modelId: "est",
    modelName: "est",
    fields: new Map([FECHA, TIPO, AREA].map((f) => [f.key, f])),
    coverage: new Map(),
    records: [
      { runtimeId: 1, values: { [FECHA.key]: "2026-01-10", [TIPO.key]: "Columna", [AREA.key]: 2 } },
      { runtimeId: 2, values: { [FECHA.key]: "2026-01-20", [TIPO.key]: "Columna", [AREA.key]: 3 } },
      { runtimeId: 3, values: { [FECHA.key]: "2026-01-15", [TIPO.key]: "Muro", [AREA.key]: 10 } },
      { runtimeId: 4, values: { [TIPO.key]: "Losa", [AREA.key]: 50 } }, // sin fecha: nunca aparece
    ],
  };
  const dated = datedDatasets([ds], FECHA.key);
  const full = dated.map((d) => d.dataset);

  it("deja solo los elementos con fecha, ordenados por ella", () => {
    assert.deepEqual(full[0].records.map((r) => r.runtimeId), [1, 3, 2]);
    assert.deepEqual(shownDatasets(dated, null)[0].records, []);
    assert.deepEqual(shownDatasets(dated, dayNumber("2026-01-15"))[0].records.map((r) => r.runtimeId), [1, 3]);
  });

  it("muestra lo que ya apareció, con las categorías y la escala del final", () => {
    const spec = { category: TIPO.key, categoryKind: "text" as const, value: null };
    const day10 = progressChart(aggregate(full, spec), shownDatasets(dated, dayNumber("2026-01-10")), spec, 50);
    // Columna (2 al final) va primero y Muro (1) después, aunque Muro aún no aparezca
    assert.deepEqual(day10.rows.map((r) => [r.label, r.value]), [["Columna", 1], ["Muro", 0]]);
    assert.equal(day10.maxValue, 2);
    assert.equal(day10.shownWithData, 1);
    assert.equal(day10.totalWithData, 3);
    const end = progressChart(aggregate(full, spec), shownDatasets(dated, dayNumber("2026-12-31")), spec, 50);
    assert.deepEqual(end.rows.map((r) => [r.label, r.value]), [["Columna", 2], ["Muro", 1]]);
    assert.deepEqual(end.rows[0].members, { est: [1, 2] });
  });

  it("suma un valor numérico y agrupa el resto en Otros", () => {
    const spec = { category: TIPO.key, categoryKind: "text" as const, value: AREA.key };
    const day15 = progressChart(aggregate(full, spec), shownDatasets(dated, dayNumber("2026-01-15")), spec, 50);
    assert.deepEqual(day15.rows.map((r) => [r.label, r.value]), [["Muro", 10], ["Columna", 2]]);
    assert.equal(day15.maxValue, 10);
    const folded = progressChart(aggregate(full, spec), shownDatasets(dated, dayNumber("2026-01-15")), spec, 1);
    assert.deepEqual(folded.rows.map((r) => [r.label, r.value]), [["Otros", 12]]);
  });
});

describe("segmentadores de la simulación", () => {
  const TIPO: Field = { key: "@objectType", label: "Tipo", group: "General", kind: "text" };
  const ds: ModelDataset = {
    modelId: "est",
    modelName: "est",
    fields: new Map([FECHA, TIPO].map((f) => [f.key, f])),
    coverage: new Map(),
    records: [
      { runtimeId: 1, values: { [FECHA.key]: "2026-01-10", [TIPO.key]: "Muro" } },
      { runtimeId: 2, values: { [FECHA.key]: "2026-01-20", [TIPO.key]: "Viga" } },
      { runtimeId: 3, values: { [TIPO.key]: "Muro" } },
      { runtimeId: 4, values: { [TIPO.key]: "Losa" } },
    ],
  };

  it("simula solo lo que pasa los segmentadores y aparta el resto", () => {
    const kept = applySlicers([ds], [{ field: TIPO.key, kind: "text", selected: ["Muro"] }]);
    const t = buildTimeline(kept, FECHA.key);
    assert.deepEqual(t.items.map((i) => i.runtimeId), [1]);
    assert.deepEqual(t.undated, { est: [3] }); // muro sin fecha: contexto
    assert.deepEqual(excludedMembers([ds], kept), { members: { est: [2, 4] }, count: 2 });
  });

  it("sin filtro no aparta nada", () => {
    assert.deepEqual(excludedMembers([ds], [ds]), { members: {}, count: 0 });
  });
});

describe("avance del día", () => {
  const t = buildTimeline([est, arq], FECHA.key); // 10-01 (x2), 15-02, 01-03

  it("da el % de los elementos de una fecha o de un tramo de fechas", () => {
    const d10 = dayNumber("2026-01-10")!;
    assert.deepEqual(periodProgress(t.items, d10, d10), { count: 2, percent: 50 });
    assert.deepEqual(periodProgress(t.items, d10 + 1, d10 + 1), { count: 0, percent: 0 });
    assert.deepEqual(periodProgress(t.items, d10 + 1, dayNumber("2026-03-01")!), { count: 2, percent: 50 });
  });

  it("arma una barra por día, o por varios días en líneas de tiempo largas", () => {
    const daily = dailyBars(t.items, t.start!, t.end!, 1000);
    assert.equal(daily.days, 1);
    assert.equal(daily.bars.length, t.end! - t.start! + 1);
    assert.equal(daily.bars.reduce((sum, b) => sum + b.count, 0), 4);
    const weekly = dailyBars(t.items, t.start!, t.end!, 10);
    assert.ok(weekly.days > 1 && weekly.bars.length <= 10);
    assert.equal(weekly.bars.reduce((sum, b) => sum + b.percent, 0), 100);
    assert.deepEqual(dailyBars([], 0, 10), { days: 1, bars: [] });
  });
});

describe("avance por semana o mes", () => {
  const d = (iso: string) => dayNumber(iso)!;

  it("ubica la semana (lunes a domingo) y el mes de una fecha", () => {
    // 2026-03-12 es jueves
    assert.equal(isoFromDay(periodStartOf(d("2026-03-12"), "semana")), "2026-03-09");
    assert.equal(isoFromDay(periodEndOf(d("2026-03-12"), "semana")), "2026-03-15");
    assert.equal(isoFromDay(periodStartOf(d("2026-03-09"), "semana")), "2026-03-09");
    assert.equal(isoFromDay(periodStartOf(d("2026-03-15"), "semana")), "2026-03-09");
    assert.equal(isoFromDay(periodStartOf(d("2026-02-17"), "mes")), "2026-02-01");
    assert.equal(isoFromDay(periodEndOf(d("2026-02-17"), "mes")), "2026-02-28");
    assert.equal(isoFromDay(periodEndOf(d("2028-02-10"), "mes")), "2028-02-29");
    assert.equal(periodStartOf(d("2026-02-17"), "dia"), d("2026-02-17"));
  });

  it("arma barras por semana y por mes que suman el 100 %", () => {
    const t = buildTimeline([est, arq], FECHA.key); // 10-01 (x2), 15-02, 01-03
    const months = periodBars(t.items, t.start!, t.end!, "mes");
    assert.deepEqual(months.bars.map((b) => [isoFromDay(b.from), b.count]), [
      ["2026-01-01", 2],
      ["2026-02-01", 1],
      ["2026-03-01", 1],
    ]);
    const weeks = periodBars(t.items, t.start!, t.end!, "semana");
    assert.equal(isoFromDay(weeks.bars[0].from), "2026-01-05");
    assert.equal(weeks.bars.reduce((sum, b) => sum + b.percent, 0), 100);
    assert.ok(weeks.bars.every((b) => b.to - b.from === 6));
  });
});
