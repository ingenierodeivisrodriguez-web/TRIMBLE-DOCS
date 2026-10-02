import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Field, ModelDataset } from "../graficos/modelData";
import {
  availableFields,
  countObjects,
  filterFields,
  filterGroups,
  groupObjects,
  NO_VALUE,
  resolveSavedFields,
  valueLabel,
} from "./grouping";

const LEVEL: Field = { key: "Constraints · Level", label: "Level", group: "Constraints", kind: "text" };
const CLASS: Field = { key: "@class", label: "Clase", group: "General", kind: "text" };
const AREA: Field = { key: "Dimensions · Area", label: "Area", group: "Dimensions", kind: "number", unit: "m²" };
const CALIDAD: Field = { key: "prop:a3", label: "cumple calidad?", group: "calidad", kind: "text" };
const FECHA: Field = { key: "prop:a2", label: "semana de instalacion", group: "programacion", kind: "date" };

function dataset(modelId: string, fields: Field[], records: [number, Record<string, string | number>][]): ModelDataset {
  const coverage = new Map<string, number>();
  for (const [, values] of records) for (const k of Object.keys(values)) coverage.set(k, (coverage.get(k) ?? 0) + 1);
  return {
    modelId,
    modelName: modelId,
    fields: new Map(fields.map((f) => [f.key, f])),
    coverage,
    records: records.map(([runtimeId, values]) => ({ runtimeId, values })),
  };
}

const est = dataset("est", [CLASS, LEVEL, AREA, CALIDAD], [
  [1, { "@class": "IfcWall", "Constraints · Level": "Piso 1", "Dimensions · Area": 12.5, "prop:a3": "Sí" }],
  [2, { "@class": "IfcWall", "Constraints · Level": "Piso 10" }],
  [3, { "@class": "IfcWall", "Constraints · Level": "Piso 2", "prop:a3": "No" }],
  [4, { "@class": "IfcSlab", "Constraints · Level": "Piso 1", "prop:a3": "Sí" }],
  [5, { "@class": "IfcBeam" }],
]);
const arq = dataset("arq", [CLASS, LEVEL, FECHA], [
  [7, { "@class": "IfcWall", "Constraints · Level": "Piso 1", "prop:a2": "2026-10-05" }],
  [8, { "@class": "IfcDoor", "Constraints · Level": 3 }],
]);

describe("campos para agrupar", () => {
  it("reúne los campos de todos los modelos, primero los atributos del proyecto", () => {
    const fields = availableFields([est, arq]);
    assert.deepEqual(
      fields.map((f) => f.key),
      ["prop:a3", "prop:a2", "@class", "Constraints · Level", "Dimensions · Area"]
    );
    assert.equal(fields.find((f) => f.key === "@class")!.objectCount, 7);
    assert.equal(fields.find((f) => f.key === "prop:a3")!.fromApp, true);
  });

  it("un campo con tipos distintos entre modelos queda como texto", () => {
    const other = dataset("x", [{ ...LEVEL, kind: "number" }], [[1, { "Constraints · Level": 3 }]]);
    assert.equal(availableFields([est, other]).find((f) => f.key === LEVEL.key)!.kind, "text");
  });

  it("busca por nombre o grupo sin importar tildes", () => {
    const fields = availableFields([est, arq]);
    assert.deepEqual(filterFields(fields, "instalación").map((f) => f.key), ["prop:a2"]);
    assert.deepEqual(filterFields(fields, "constraints level").map((f) => f.key), ["Constraints · Level"]);
  });
});

describe("agrupar", () => {
  it("agrupa por nivel en orden natural, con (Sin valor) al final", () => {
    const rows = groupObjects([est, arq], [LEVEL]);
    assert.deepEqual(rows.map((r) => [r.labels[0], r.objects]), [
      ["3", 1],
      ["Piso 1", 3],
      ["Piso 2", 1],
      ["Piso 10", 1],
      [NO_VALUE, 1],
    ]);
    // members per model, ready for the viewer selection
    assert.deepEqual(rows[1].members, { est: [1, 4], arq: [7] });
  });

  it("combina varios campos: muros del Piso 1", () => {
    const rows = groupObjects([est, arq], [CLASS, LEVEL]);
    const muros1 = rows.find((r) => r.labels[0] === "IfcWall" && r.labels[1] === "Piso 1")!;
    assert.equal(muros1.objects, 2);
    assert.deepEqual(muros1.members, { est: [1], arq: [7] });
  });

  it("agrupa por un atributo del proyecto (cumple calidad?)", () => {
    const rows = groupObjects([est], [CALIDAD]);
    assert.deepEqual(rows.map((r) => [r.labels[0], r.objects]), [["No", 1], ["Sí", 2], [NO_VALUE, 2]]);
  });

  it("muestra fechas en DD-MM-AAAA y números con separador de miles", () => {
    assert.equal(valueLabel("date", "2026-10-05"), "05-10-2026");
    assert.equal(valueLabel("date", "2026-10-05T08:30:00Z"), "05-10-2026");
    assert.equal(valueLabel("number", 12500.5), "12.500,5");
    assert.equal(valueLabel("text", "Piso 1"), "Piso 1");
    assert.deepEqual(groupObjects([arq], [FECHA]).map((r) => r.labels[0]), ["05-10-2026", NO_VALUE]);
  });

  it("filtra los grupos por texto y suma sus elementos", () => {
    const rows = groupObjects([est, arq], [CLASS, LEVEL]);
    const walls = filterGroups(rows, "ifcwall piso");
    assert.equal(countObjects(walls), 4);
    assert.equal(filterGroups(rows, "  ").length, rows.length);
  });

  it("sin campos no hay grupos", () => {
    assert.deepEqual(groupObjects([est], []), []);
  });
});

describe("configuraciones guardadas", () => {
  it("recupera los campos que siguen existiendo y avisa de los que faltan", () => {
    const fields = availableFields([est]);
    const { found, missing } = resolveSavedFields(
      [
        { key: "@class", label: "Clase" },
        { key: "prop:borrado", label: "Atributo borrado" },
      ],
      fields
    );
    assert.deepEqual(found.map((f) => f.key), ["@class"]);
    assert.deepEqual(missing, ["Atributo borrado"]);
  });
});
