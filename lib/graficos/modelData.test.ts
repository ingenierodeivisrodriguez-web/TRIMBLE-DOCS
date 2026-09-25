import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregate, buildDataset, commonFields, foldRows, objectHasData, RawObject } from "./modelData";

function beam(id: number, profile: string, lengthMm: number, volume: number): RawObject {
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

  it("offers a field as text when it is numeric in one model and text in another", () => {
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
    beam(1, "HEA240", 6000, 0.5),
    beam(2, "HEA240", 6000, 0.5),
    beam(3, "HEA200", 4000, 0.25),
    { id: 4, class: "IfcPlate" },
  ]);

  it("returns null until a category is chosen", () => {
    assert.equal(aggregate([dataset], { category: null, value: null }), null);
  });

  it("counts objects per category, largest first", () => {
    const result = aggregate([dataset], { category: "@objectType", value: null })!;
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
    const result = aggregate([dataset], { category: "@objectType", value: "Dimensiones · Volumen" })!;
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value, r.objects]),
      [
        ["HEA240", 1, 2],
        ["HEA200", 0.25, 1],
      ]
    );
  });

  it("combines several models", () => {
    const other = buildDataset("m2", "Cubierta", [beam(1, "HEA240", 1000, 2)]);
    const result = aggregate([dataset, other], { category: "@model", value: "Dimensiones · Volumen" })!;
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value]),
      [
        ["Cubierta", 2],
        ["Estructura", 1.25],
      ]
    );
  });
});

describe("foldRows", () => {
  const rows = [5, 4, 3, 2, 1].map((value, i) => ({ label: `R${i}`, value, objects: 1 }));

  it("folds the smallest rows into 'Otros'", () => {
    const folded = foldRows(rows, 3);
    assert.deepEqual(
      folded.map((r) => [r.label, r.value, r.objects]),
      [
        ["R0", 5, 1],
        ["R1", 4, 1],
        ["Otros", 6, 3],
      ]
    );
  });

  it("leaves short lists untouched", () => {
    assert.equal(foldRows(rows, 5), rows);
  });
});
