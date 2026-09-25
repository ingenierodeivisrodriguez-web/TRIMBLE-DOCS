import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregate,
  applySlicers,
  bucketCounts,
  buildDataset,
  commonFields,
  compare,
  foldCompareRows,
  foldRows,
  memberCount,
  monthLabel,
  objectHasData,
  parseDateText,
  RawObject,
} from "./modelData";

function beam(id: number, profile: string, lengthMm: number, volume: number, date?: string): RawObject {
  return {
    id,
    class: "IfcBeam",
    product: { name: `Viga ${id}`, objectType: profile },
    properties: [
      {
        name: "Dimensiones",
        properties: [
          { name: "Longitud", value: lengthMm, type: 0 },
          { name: "Volumen", value: volume, type: 2 },
        ],
      },
      { name: "Material", properties: [{ name: "Nombre", value: "Acero", type: 5 }] },
      ...(date ? [{ name: "Obra", properties: [{ name: "Montaje", value: date, type: 5 }] }] : []),
    ],
  };
}

describe("buildDataset", () => {
  const dataset = buildDataset("m1", "Estructura", [beam(1, "HEA240", 6000, 0.5), beam(2, "HEA200", 4000, 0.25)]);

  it("flattens property sets into 'Set · Property' fields", () => {
    assert.equal(dataset.records[0].values["Material · Nombre"], "Acero");
    assert.equal(dataset.fields.get("Dimensiones · Volumen")?.unit, "m³");
    assert.equal(dataset.fields.get("Dimensiones · Volumen")?.kind, "number");
  });

  it("converts lengths from mm to m", () => {
    assert.equal(dataset.records[0].values["Dimensiones · Longitud"], 6);
    assert.equal(dataset.fields.get("Dimensiones · Longitud")?.unit, "m");
  });

  it("adds the built-in model / class / name / type fields", () => {
    const values = dataset.records[1].values;
    assert.equal(values["@model"], "Estructura");
    assert.equal(values["@class"], "IfcBeam");
    assert.equal(values["@objectType"], "HEA200");
  });

  it("counts how many objects carry each field", () => {
    assert.equal(dataset.coverage.get("Dimensiones · Volumen"), 2);
  });

  it("skips empty values and non-numeric values of numeric properties", () => {
    const d = buildDataset("m", "M", [
      {
        id: 1,
        properties: [
          {
            name: "P",
            properties: [
              { name: "Vacio", value: "", type: 5 },
              { name: "Area", value: "n/a", type: 1 },
            ],
          },
        ],
      },
    ]);
    assert.equal(d.fields.has("P · Vacio"), false);
    assert.equal(d.fields.has("P · Area"), false);
  });

  it("turns booleans into Sí / No", () => {
    const d = buildDataset("m", "M", [
      { id: 1, properties: [{ name: "P", properties: [{ name: "Externo", value: 1, type: 10 }] }] },
    ]);
    assert.equal(d.records[0].values["P · Externo"], "Sí");
  });

  it("recognises dates in text properties and DateTime timestamps", () => {
    const d = buildDataset("m", "M", [
      {
        id: 1,
        properties: [
          {
            name: "Obra",
            properties: [
              { name: "Montaje", value: "15/03/2026", type: 5 },
              { name: "Inicio", value: 1772582400, type: 8 }, // 2026-03-04 in seconds
            ],
          },
        ],
      },
    ]);
    assert.equal(d.fields.get("Obra · Montaje")?.kind, "date");
    assert.equal(d.records[0].values["Obra · Montaje"], "2026-03-15");
    assert.equal(d.records[0].values["Obra · Inicio"], "2026-03-04");
  });

  it("treats a field that mixes dates and text as text", () => {
    const d = buildDataset("m", "M", [
      { id: 1, properties: [{ name: "P", properties: [{ name: "Fecha", value: "2026-03-01", type: 5 }] }] },
      { id: 2, properties: [{ name: "P", properties: [{ name: "Fecha", value: "pendiente", type: 5 }] }] },
    ]);
    assert.equal(d.fields.get("P · Fecha")?.kind, "text");
  });
});

describe("parseDateText", () => {
  it("accepts ISO and day-first dates", () => {
    assert.equal(parseDateText("2026-03-15"), "2026-03-15");
    assert.equal(parseDateText("2026-03-15T10:30:00Z"), "2026-03-15");
    assert.equal(parseDateText("15.03.2026"), "2026-03-15");
    assert.equal(parseDateText("03/15/2026"), "2026-03-15");
  });

  it("rejects text that only starts with a date, and impossible dates", () => {
    assert.equal(parseDateText("12/05/2024 - Rev B"), null);
    assert.equal(parseDateText("2026-13-01"), null);
    assert.equal(parseDateText("HEA240"), null);
  });

  it("formats month keys for display", () => {
    assert.equal(monthLabel("2026-03"), "mar 2026");
  });
});

describe("objectHasData", () => {
  it("is false for objects without any property", () => {
    assert.equal(objectHasData({ id: 1, properties: [{ name: "Vacío", properties: [] }] }), false);
    assert.equal(objectHasData(beam(1, "HEA240", 1000, 1)), true);
  });
});

describe("commonFields", () => {
  const a = buildDataset("a", "A", [beam(1, "HEA240", 1000, 1)]);
  const b = buildDataset("b", "B", [
    { id: 1, class: "IfcSlab", properties: [{ name: "Dimensiones", properties: [{ name: "Volumen", value: 3, type: 2 }] }] },
  ]);

  it("keeps only the fields every model has, built-ins first", () => {
    const keys = commonFields([a, b]).map((f) => f.key);
    assert.deepEqual(keys, ["@model", "@class", "Dimensiones · Volumen"]);
  });

  it("adds up how many objects carry each field", () => {
    const volume = commonFields([a, b]).find((f) => f.key === "Dimensiones · Volumen");
    assert.equal(volume?.objectCount, 2);
  });

  it("offers a field as text when its kind differs between models", () => {
    const c = buildDataset("c", "C", [
      { id: 1, properties: [{ name: "Dimensiones", properties: [{ name: "Volumen", value: "grande", type: 5 }] }] },
    ]);
    const volume = commonFields([a, c]).find((f) => f.key === "Dimensiones · Volumen");
    assert.equal(volume?.kind, "text");
    assert.equal(volume?.unit, undefined);
  });

  it("returns nothing without models", () => {
    assert.deepEqual(commonFields([]), []);
  });
});

describe("aggregate", () => {
  const dataset = buildDataset("m1", "Estructura", [
    beam(1, "HEA240", 6000, 0.5, "2026-03-02"),
    beam(2, "HEA240", 6000, 0.5, "2026-04-10"),
    beam(3, "HEA200", 4000, 0.25, "2026-03-20"),
    { id: 4, class: "IfcPlate" },
  ]);

  it("counts objects per category, largest first", () => {
    const result = aggregate([dataset], { category: "@objectType", categoryKind: "text", value: null });
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value]),
      [
        ["HEA240", 2],
        ["HEA200", 1],
      ]
    );
    assert.equal(result.objectsWithData, 3);
    assert.equal(result.totalObjects, 4);
  });

  it("sums a numeric field per category", () => {
    const result = aggregate([dataset], { category: "@objectType", categoryKind: "text", value: "Dimensiones · Volumen" });
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value, r.objects]),
      [
        ["HEA240", 1, 2],
        ["HEA200", 0.25, 1],
      ]
    );
  });

  it("remembers which objects are behind each row, per model", () => {
    const result = aggregate([dataset], { category: "@objectType", categoryKind: "text", value: null });
    assert.deepEqual(result.rows[0].members, { m1: [1, 2] });
  });

  it("groups dates by month, in date order", () => {
    const result = aggregate([dataset], { category: "Obra · Montaje", categoryKind: "date", value: null });
    assert.deepEqual(
      result.rows.map((r) => [r.key, r.label, r.value]),
      [
        ["2026-03", "mar 2026", 2],
        ["2026-04", "abr 2026", 1],
      ]
    );
  });

  it("combines several models", () => {
    const other = buildDataset("m2", "Cubierta", [beam(1, "HEA240", 1000, 2)]);
    const result = aggregate([dataset, other], { category: "@model", categoryKind: "text", value: "Dimensiones · Volumen" });
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value]),
      [
        ["Cubierta", 2],
        ["Estructura", 1.25],
      ]
    );
  });
});

describe("slicers", () => {
  const dataset = buildDataset("m1", "Estructura", [
    beam(1, "HEA240", 6000, 0.5, "2026-03-02"),
    beam(2, "HEA240", 6000, 0.5, "2026-04-10"),
    beam(3, "HEA200", 4000, 0.25, "2026-03-20"),
  ]);

  it("lists each value of a field with its object count", () => {
    assert.deepEqual(
      bucketCounts([dataset], "@objectType", "text").map((b) => [b.key, b.objects]),
      [
        ["HEA240", 2],
        ["HEA200", 1],
      ]
    );
    assert.deepEqual(
      bucketCounts([dataset], "Obra · Montaje", "date").map((b) => b.key),
      ["2026-03", "2026-04"]
    );
  });

  it("keeps only the objects with a selected value", () => {
    const [filtered] = applySlicers([dataset], [{ field: "@objectType", kind: "text", selected: ["HEA200"] }]);
    assert.deepEqual(filtered.records.map((r) => r.runtimeId), [3]);
  });

  it("filters dates by month and combines slicers with AND", () => {
    const [filtered] = applySlicers(
      [dataset],
      [
        { field: "Obra · Montaje", kind: "date", selected: ["2026-03"] },
        { field: "@objectType", kind: "text", selected: ["HEA240"] },
      ]
    );
    assert.deepEqual(filtered.records.map((r) => r.runtimeId), [1]);
  });

  it("does nothing when every value is selected", () => {
    const datasets = [dataset];
    assert.equal(applySlicers(datasets, [{ field: "@objectType", kind: "text", selected: null }]), datasets);
  });
});

describe("compare", () => {
  const dataset = buildDataset("m1", "Estructura", [
    beam(1, "HEA240", 6000, 0.5, "2026-03-02"),
    beam(2, "HEA240", 6000, 0.5, "2026-04-10"),
    beam(3, "HEA200", 4000, 0.25, "2026-03-20"),
    beam(4, "HEA200", 4000, 0.25, "2026-05-01"),
  ]);
  const spec = {
    category: "@objectType",
    categoryKind: "text" as const,
    value: "Dimensiones · Volumen",
    compareBy: "Obra · Montaje",
    compareKind: "date" as const,
    periodA: "2026-03",
    periodB: "2026-04",
  };

  it("puts each category's value in month A next to month B", () => {
    const result = compare([dataset], spec);
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.a, r.b]),
      [
        ["HEA240", 0.5, 0.5],
        ["HEA200", 0.25, 0],
      ]
    );
    assert.equal(result.objectsWithData, 3); // the May beam is in neither period
  });

  it("keeps the objects of each side apart", () => {
    const [row] = compare([dataset], spec).rows;
    assert.deepEqual(row.membersA, { m1: [1] });
    assert.deepEqual(row.membersB, { m1: [2] });
  });

  it("folds the smallest categories together", () => {
    const rows = compare([dataset], spec).rows;
    const folded = foldCompareRows(rows, 1);
    assert.equal(folded.length, 1);
    assert.equal(folded[0].a, 0.75);
    assert.equal(memberCount(folded[0].membersA), 2);
  });
});

describe("foldRows", () => {
  const rows = [5, 4, 3, 2, 1].map((value, i) => ({
    key: `R${i}`,
    label: `R${i}`,
    value,
    objects: 1,
    members: { m: [i] },
  }));

  it("folds the smallest rows into 'Otros', keeping their objects", () => {
    const folded = foldRows(rows, 3);
    assert.deepEqual(
      folded.map((r) => [r.label, r.value, r.objects]),
      [
        ["R0", 5, 1],
        ["R1", 4, 1],
        ["Otros", 6, 3],
      ]
    );
    assert.deepEqual(folded[2].members, { m: [2, 3, 4] });
  });

  it("folds the oldest months into 'Anteriores' when in date order", () => {
    const folded = foldRows(rows, 3, true);
    assert.deepEqual(
      folded.map((r) => r.label),
      ["Anteriores", "R3", "R4"]
    );
  });

  it("leaves short lists untouched", () => {
    assert.equal(foldRows(rows, 5), rows);
  });
});
