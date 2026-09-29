import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregate, buildDataset, commonFields } from "./modelData";
import {
  convertPsetValue,
  entityLink,
  guidFromLink,
  LibrariesPayload,
  librarySummary,
  mergePsets,
  propertyLabel,
  psetFieldKey,
} from "./psets";

describe("links", () => {
  it("round-trips an IFC GUID through the frn link", () => {
    const guid = "3CqVfw$t15ihB2vPgB1wri";
    assert.equal(entityLink(guid), "frn:entity:3CqVfw%24t15ihB2vPgB1wri");
    assert.equal(guidFromLink(entityLink(guid)), guid);
  });

  it("takes the GUID from the last part of longer links", () => {
    assert.equal(guidFromLink("frn:tc:project:abc:entity:0aB%24x"), "0aB$x");
  });
});

describe("convertPsetValue", () => {
  it("turns booleans (and their words) into Sí / No", () => {
    assert.deepEqual(convertPsetValue({ type: "boolean" }, true), { kind: "text", value: "Sí" });
    assert.deepEqual(convertPsetValue({ type: "boolean" }, "false"), { kind: "text", value: "No" });
    assert.deepEqual(convertPsetValue({ type: "boolean" }, "Verdadero"), { kind: "text", value: "Sí" });
    assert.deepEqual(convertPsetValue(undefined, false), { kind: "text", value: "No" });
  });

  it("keeps numbers and dates typed", () => {
    assert.deepEqual(convertPsetValue({ type: "number" }, "12.5"), { kind: "number", value: 12.5 });
    assert.deepEqual(convertPsetValue({ type: "string", format: "date" }, "2026-09-29T10:00:00Z"), {
      kind: "date",
      value: "2026-09-29",
    });
  });

  it("skips empty values", () => {
    assert.equal(convertPsetValue({ type: "string" }, ""), null);
    assert.equal(convertPsetValue({ type: "number" }, "n/a"), null);
  });
});

const library: LibrariesPayload = {
  libs: [{ id: "lib1", name: "control de calidad" }],
  defs: [
    {
      libId: "lib1",
      id: "def1",
      name: "controlConstruccion",
      props: { construido: { type: "boolean" }, avance: { type: "number" } },
      i18n: { es: { name: "control construccion", props: { construido: "está construido" } } },
    },
  ],
  psets: [
    { link: entityLink("G1"), libId: "lib1", defId: "def1", props: { construido: true, avance: 100 } },
    { link: entityLink("G2"), libId: "lib1", defId: "def1", props: { construido: false, avance: 40 } },
    { link: entityLink("G3"), libId: "lib1", defId: "def1", props: { construido: true } },
  ],
};

describe("mergePsets", () => {
  const walls = buildDataset("m1", "Arquitectura", [
    { id: 1, class: "IfcWall" },
    { id: 2, class: "IfcWall" },
    { id: 3, class: "IfcWall" },
    { id: 4, class: "IfcSlab" },
  ]);
  const guids = { m1: new Map([[1, "G1"], [2, "G2"], [3, "G3"], [4, "G4"]]) };
  const construido = psetFieldKey("lib1", "def1", "construido");

  it("adds the library values to the matching objects", () => {
    const [merged] = mergePsets([walls], guids, library);
    assert.equal(merged.records[0].values[construido], "Sí");
    assert.equal(merged.records[1].values[construido], "No");
    assert.equal(merged.records[3].values[construido], undefined);
    assert.equal(merged.coverage.get(construido), 3);
  });

  it("names fields with the library's translations", () => {
    const [merged] = mergePsets([walls], guids, library);
    const field = merged.fields.get(construido);
    assert.equal(field?.label, "está construido");
    assert.equal(field?.group, "control construccion");
    assert.equal(propertyLabel(library.defs[0], "avance"), "avance");
  });

  it("charts a yes/no property like any other", () => {
    const merged = mergePsets([walls], guids, library);
    const result = aggregate(merged, { category: construido, categoryKind: "text", value: null });
    assert.deepEqual(
      result.rows.map((r) => [r.label, r.value]),
      [
        ["Sí", 2],
        ["No", 1],
      ]
    );
  });

  it("offers library fields for every model, even one without values", () => {
    const other = buildDataset("m2", "Estructura", [{ id: 1, class: "IfcBeam" }]);
    const merged = mergePsets([walls, other], { ...guids, m2: new Map([[1, "X9"]]) }, library);
    assert.ok(commonFields(merged).some((f) => f.key === construido));
  });

  it("leaves datasets whose object ids aren't known yet untouched", () => {
    const [merged] = mergePsets([walls], {}, library);
    assert.equal(merged.records[0], walls.records[0]);
  });

  it("summarises objects per library", () => {
    assert.deepEqual(librarySummary(library), [{ name: "control de calidad", objects: 3 }]);
  });
});
