import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuidToIfcGuid } from "../propiedades/ifcGuid";
import { buildDataset, commonFields, RawObject } from "./modelData";
import {
  convertPropiedadValue,
  elementIfcGuid,
  mergePropiedades,
  PropiedadesData,
  propiedadesMatches,
  propiedadFieldKey,
} from "./propiedades";
import { readObjectGuids, ViewerLike } from "./viewerReader";

const REVIT_GUID = "3CqVfw$t15ihB2vPgB1wri";
const IFC_UUID = "e9ae8a6f-bdd4-4d6e-8b42-b39a0b07a2a1";
const IFC_GUID = uuidToIfcGuid(IFC_UUID)!;

// A Revit element carries its IFCGUID as a property; an IFC element only has the viewer's external id.
const revitWall: RawObject = {
  id: 1,
  class: "IfcWall",
  properties: [{ name: "Datos de identidad", properties: [{ name: "IfcGUID", value: REVIT_GUID, type: 5 }] }],
};
const ifcWall: RawObject = { id: 2, class: "IfcWall", properties: [{ name: "Pset", properties: [{ name: "Nivel", value: "N1", type: 5 }] }] };
const plainSlab: RawObject = { id: 3, class: "IfcSlab" };

const data: PropiedadesData = {
  definitions: [
    { id: "a-costo", title: "costo real", dataType: "number", group: "costo", sortOrder: 20, active: true },
    { id: "a-calidad", title: "cumple calidad?", dataType: "boolean", group: "calidad", sortOrder: 10, active: true },
    { id: "a-semana", title: "semana de instalacion", dataType: "date", group: "programacion", sortOrder: 30, active: true },
    { id: "a-viejo", title: "antiguo", dataType: "text", group: "otros", sortOrder: 40, active: false },
    { id: "a-retirado", title: "retirado con valores", dataType: "text", group: "otros", sortOrder: 50, active: false },
  ],
  values: [
    { ifcGuid: REVIT_GUID, attributeId: "a-costo", value: 20000 },
    { ifcGuid: REVIT_GUID, attributeId: "a-calidad", value: false },
    { ifcGuid: IFC_GUID, attributeId: "a-calidad", value: true },
    { ifcGuid: IFC_GUID, attributeId: "a-semana", value: "2026-10-05" },
    { ifcGuid: IFC_GUID, attributeId: "a-retirado", value: "sí" },
    { ifcGuid: "0000000000000000000000", attributeId: "a-costo", value: 5 },
  ],
};

describe("Propiedades values", () => {
  it("convert to what the charts use", () => {
    assert.equal(convertPropiedadValue("boolean", true), "Sí");
    assert.equal(convertPropiedadValue("boolean", false), "No");
    assert.equal(convertPropiedadValue("number", 25000), 25000);
    assert.equal(convertPropiedadValue("number", "abc"), null);
    assert.equal(convertPropiedadValue("date", "2026-10-05"), "2026-10-05");
    assert.equal(convertPropiedadValue("date", "2026-10-05T00:00:00Z"), "2026-10-05");
    assert.equal(convertPropiedadValue("text", "  Ciclo 3 "), "Ciclo 3");
    assert.equal(convertPropiedadValue("text", ""), null);
  });

  it("find each element by the IFCGUID the Propiedades panel stores: GUID property first, else the converted external id", () => {
    const [revit, ifc, slab] = buildDataset("m1", "Modelo", [revitWall, ifcWall, plainSlab]).records;
    assert.equal(revit.ifcGuid, REVIT_GUID);
    assert.equal(ifc.ifcGuid, undefined);
    const external = new Map([
      [1, "11111111-2222-3333-4444-555555555555"],
      [2, IFC_UUID],
    ]);
    assert.equal(elementIfcGuid(revit, external), REVIT_GUID);
    assert.equal(elementIfcGuid(ifc, external), IFC_GUID);
    assert.equal(elementIfcGuid(slab, external), null);
  });
});

describe("mergePropiedades", () => {
  const dataset = buildDataset("m1", "Modelo", [revitWall, ifcWall, plainSlab]);
  const guidMaps = { m1: new Map([[2, IFC_UUID]]) };

  it("adds the catalog as fields, and leaves out inactive attributes nobody uses", () => {
    const [merged] = mergePropiedades([dataset], guidMaps, data);
    const field = (id: string) => merged.fields.get(propiedadFieldKey(id));
    assert.deepEqual(
      { label: field("a-costo")?.label, group: field("a-costo")?.group, kind: field("a-costo")?.kind },
      { label: "costo real", group: "costo", kind: "number" }
    );
    assert.equal(field("a-calidad")?.kind, "text");
    assert.equal(field("a-semana")?.kind, "date");
    assert.equal(field("a-viejo"), undefined);
    assert.ok(field("a-retirado"));
  });

  it("fills in each object's values, in Revit and IFC models alike", () => {
    const [merged] = mergePropiedades([dataset], guidMaps, data);
    const [revit, ifc, slab] = merged.records;
    assert.equal(revit.values[propiedadFieldKey("a-costo")], 20000);
    assert.equal(revit.values[propiedadFieldKey("a-calidad")], "No");
    assert.equal(ifc.values[propiedadFieldKey("a-calidad")], "Sí");
    assert.equal(ifc.values[propiedadFieldKey("a-semana")], "2026-10-05");
    assert.equal(slab, dataset.records[2], "objects without values are reused as-is");
    assert.equal(merged.coverage.get(propiedadFieldKey("a-calidad")), 2);
    assert.equal(propiedadesMatches([merged]), 2);
  });

  it("offers the attributes as common fields of every model, even one without values", () => {
    const other = buildDataset("m2", "Otro", [plainSlab]);
    const merged = mergePropiedades([dataset, other], guidMaps, data);
    const keys = commonFields(merged).map((f) => f.key);
    assert.ok(keys.includes(propiedadFieldKey("a-costo")));
    assert.ok(keys.includes(propiedadFieldKey("a-semana")));
  });

  it("still matches Revit elements before the viewer's GUIDs are read", () => {
    const [merged] = mergePropiedades([dataset], {}, data);
    assert.equal(merged.records[0].values[propiedadFieldKey("a-costo")], 20000);
    assert.equal(merged.records[1].values[propiedadFieldKey("a-calidad")], undefined);
  });
});

describe("readObjectGuids", () => {
  // Like the viewer: the whole call fails if any object in it has no external id.
  function fakeViewer(withoutId: Set<number>, calls: { n: number }): ViewerLike {
    return {
      convertToObjectIds: async (_model: string, ids: number[]) => {
        calls.n++;
        if (ids.some((id) => withoutId.has(id))) throw new Error("Object has no external id");
        return ids.map((id) => `guid-${id}`);
      },
    } as unknown as ViewerLike;
  }

  it("leaves out only the objects without an external id", async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => i + 1);
    const calls = { n: 0 };
    const map = await readObjectGuids(fakeViewer(new Set([17, 2500]), calls), "m1", ids);
    assert.equal(map.size, 4998);
    assert.equal(map.get(1), "guid-1");
    assert.equal(map.has(17), false);
    assert.ok(calls.n < 60, `${calls.n} calls`);
  });

  it("reports the error when no object has one", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    await assert.rejects(readObjectGuids(fakeViewer(new Set(ids), { n: 0 }), "m1", ids), /no external id/);
  });
});
