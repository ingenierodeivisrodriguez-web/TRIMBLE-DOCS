import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Field, ModelDataset } from "../graficos/modelData";
import {
  buildTimeline,
  countUpTo,
  dayNumber,
  isoFromDay,
  memberCount,
  membersOf,
  progressCurve,
  progressPercent,
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
