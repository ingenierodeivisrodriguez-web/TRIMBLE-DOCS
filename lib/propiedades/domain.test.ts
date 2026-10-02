import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consequences, groupDefinitions, pendingChanges, summarizeValues } from "./form";
import { ifcGuidToUuid, isIfcGuid, normalizeGuid, resolveIfcGuid, uuidToIfcGuid } from "./ifcGuid";
import type { AttributeDefinition, StoredValue } from "./types";
import {
  formatValue,
  isoToDisplay,
  isValidIsoDate,
  parseDisplayDate,
  parseNumberInput,
  validateValue,
} from "./values";

describe("dates (shown as DD-MM-AAAA, stored as ISO)", () => {
  it("formats ISO for display", () => {
    assert.equal(isoToDisplay("2026-05-20"), "20-05-2026");
  });

  it("reads what the user types, day first", () => {
    assert.equal(parseDisplayDate("20-05-2026"), "2026-05-20");
    assert.equal(parseDisplayDate("2/5/2026"), "2026-05-02");
    assert.equal(parseDisplayDate("20.05.2026"), "2026-05-20");
  });

  it("rejects impossible or incomplete dates", () => {
    assert.equal(parseDisplayDate("31-02-2026"), null);
    assert.equal(parseDisplayDate("20-13-2026"), null);
    assert.equal(parseDisplayDate("2026-05-20"), null);
    assert.equal(parseDisplayDate("20-05-26"), null);
    assert.equal(isValidIsoDate("2026-02-29"), false);
    assert.equal(isValidIsoDate("2028-02-29"), true);
  });
});

describe("numbers", () => {
  it("accepts a decimal comma or dot", () => {
    assert.equal(parseNumberInput("12,5"), 12.5);
    assert.equal(parseNumberInput("12.5"), 12.5);
    assert.equal(parseNumberInput("-3,25"), -3.25);
    assert.equal(parseNumberInput(" 42 "), 42);
  });

  it("understands thousands separators", () => {
    assert.equal(parseNumberInput("1.234,5"), 1234.5);
    assert.equal(parseNumberInput("1,234.5"), 1234.5);
    assert.equal(parseNumberInput("1.234.567"), 1234567);
  });

  it("rejects text", () => {
    assert.equal(parseNumberInput("doce"), null);
    assert.equal(parseNumberInput("12a"), null);
    assert.equal(parseNumberInput(""), null);
  });
});

describe("validateValue", () => {
  it("accepts values that match the type", () => {
    assert.deepEqual(validateValue("text", "  Anclajes  "), { ok: true, value: "Anclajes" });
    assert.deepEqual(validateValue("number", 3.5), { ok: true, value: 3.5 });
    assert.deepEqual(validateValue("boolean", false), { ok: true, value: false });
    assert.deepEqual(validateValue("date", "2026-05-20"), { ok: true, value: "2026-05-20" });
  });

  it("rejects values that don't", () => {
    assert.equal(validateValue("number", "3,5").ok, false);
    assert.equal(validateValue("number", Number.NaN).ok, false);
    assert.equal(validateValue("boolean", "sí").ok, false);
    assert.equal(validateValue("date", "20-05-2026").ok, false);
    assert.equal(validateValue("text", "   ").ok, false);
  });

  it("formats values for people", () => {
    assert.equal(formatValue("date", "2026-05-20"), "20-05-2026");
    assert.equal(formatValue("boolean", true), "Sí");
    assert.equal(formatValue("number", 12.5), "12,5");
  });
});

describe("IFC GUID", () => {
  it("compresses and expands the boundary GUIDs", () => {
    assert.equal(uuidToIfcGuid("00000000-0000-0000-0000-000000000000"), "0000000000000000000000");
    assert.equal(uuidToIfcGuid("ffffffff-ffff-ffff-ffff-ffffffffffff"), "3$$$$$$$$$$$$$$$$$$$$$");
    assert.equal(ifcGuidToUuid("3$$$$$$$$$$$$$$$$$$$$$"), "ffffffff-ffff-ffff-ffff-ffffffffffff");
  });

  it("round-trips any GUID", () => {
    for (let i = 0; i < 200; i++) {
      const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const ifc = uuidToIfcGuid(uuid)!;
      assert.ok(isIfcGuid(ifc), ifc);
      assert.equal(ifcGuidToUuid(ifc), uuid);
    }
  });

  it("normalizes every form to the 22-char IFC GUID", () => {
    const ifc = "3CqVfw$t15ihB2vPgB1wri";
    const uuid = ifcGuidToUuid(ifc)!;
    assert.equal(normalizeGuid(ifc), ifc);
    assert.equal(normalizeGuid(uuid), ifc);
    assert.equal(normalizeGuid(uuid.replace(/-/g, "").toUpperCase()), ifc);
    assert.equal(normalizeGuid(`{${uuid}}`), ifc);
    assert.equal(normalizeGuid("123456"), null);
    assert.equal(normalizeGuid("4CqVfw$t15ihB2vPgB1wri"), null); // first char can't exceed 3
  });
});

describe("resolveIfcGuid", () => {
  const ifc = "3CqVfw$t15ihB2vPgB1wri";
  const uuid = ifcGuidToUuid(ifc)!;

  it("uses the viewer's external id (uncompressed GUID) for IFC models", () => {
    const r = resolveIfcGuid(uuid, [{ name: "Pset_WallCommon", properties: [{ name: "IsExternal", value: 1 }] }]);
    assert.equal(r.guid, ifc);
    assert.equal(r.source, "external");
  });

  it("prefers an explicit IfcGUID property (Revit models), ignoring the type's GUID", () => {
    const r = resolveIfcGuid("rvt-element-123", [
      { name: "Datos de identidad", properties: [{ name: "Tipo IfcGUID", value: "1abcdefghijklmnopqrstu" }] },
      { name: "IFC", properties: [{ name: "IfcGUID", value: ifc }] },
    ]);
    assert.equal(r.guid, ifc);
    assert.equal(r.source, "property");
    assert.match(r.sourceLabel, /IFC · IfcGUID/);
  });

  it("flags when the property and the external id disagree", () => {
    const other = uuidToIfcGuid("00000000-0000-0000-0000-000000000001")!;
    const r = resolveIfcGuid(ifcGuidToUuid(other), [{ name: "IFC", properties: [{ name: "GlobalId", value: ifc }] }]);
    assert.equal(r.guid, ifc);
    assert.ok(r.conflict);
  });

  it("has no GUID for non-IFC geometry", () => {
    const r = resolveIfcGuid("2F4A", [{ name: "DWG", properties: [{ name: "Handle", value: "2F4A" }] }]);
    assert.equal(r.guid, null);
    assert.equal(r.source, null);
  });
});

function def(id: string, title: string, group: string, sortOrder: number, extra: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id,
    projectId: "p",
    title,
    dataType: "text",
    group,
    sortOrder,
    active: true,
    valueCount: 0,
    updatedAt: "",
    updatedBy: null,
    ...extra,
  };
}

function val(ifcGuid: string, attributeId: string, value: string | number | boolean): StoredValue {
  return { ifcGuid, modelId: "m", attributeId, value, updatedAt: "2026-05-01T10:00:00Z", updatedBy: "Ana" };
}

describe("summarizeValues", () => {
  it("tells same, empty and mixed apart", () => {
    const s = summarizeValues(
      ["g1", "g2"],
      [val("g1", "a", "X"), val("g2", "a", "X"), val("g1", "b", 1), val("g2", "b", 2), val("g1", "c", true)]
    );
    assert.equal(s.get("a")?.kind, "same");
    assert.deepEqual(s.get("b"), { kind: "mixed", withValue: 2, distinct: 2 });
    // one element has it, the other doesn't: mixed
    assert.deepEqual(s.get("c"), { kind: "mixed", withValue: 1, distinct: 1 });
    assert.equal(s.get("d"), undefined);
  });

  it("ignores values of elements outside the selection", () => {
    const s = summarizeValues(["g1"], [val("g1", "a", "X"), val("g9", "a", "Y")]);
    assert.equal(s.get("a")?.kind, "same");
  });
});

describe("pendingChanges and consequences", () => {
  const defs = [def("a", "Estado", "Obra", 1), def("b", "Avance", "Obra", 2, { dataType: "number" })];
  const summaries = summarizeValues(["g1", "g2"], [val("g1", "a", "Listo"), val("g2", "a", "Listo"), val("g1", "b", 10), val("g2", "b", 20)]);

  it("only saves fields the user edited (untouched mixed fields are left alone)", () => {
    const changes = pendingChanges(new Map([["a", "Pendiente"]]), summaries);
    assert.deepEqual(changes, [{ attributeId: "a", value: "Pendiente" }]);
  });

  it("drops edits that change nothing", () => {
    assert.deepEqual(pendingChanges(new Map([["a", "Listo"], ["z", null]]), summaries), []);
  });

  it("asks for confirmation before replacing mixed values or clearing", () => {
    const changes = pendingChanges(new Map<string, string | number | null>([["b", 50], ["a", null]]), summaries);
    const c = consequences(changes, summaries, defs, 2);
    assert.deepEqual(c.map((x) => x.title), ["Avance", "Estado"]);
    assert.match(c[0].detail, /valores distintos.*"50"/);
    assert.match(c[1].detail, /se borrará el valor "Listo"/);
  });
});

describe("groupDefinitions", () => {
  it("orders groups by their first attribute and attributes by display order", () => {
    const groups = groupDefinitions([
      def("1", "Pintura", "Acabados", 30),
      def("2", "Fecha de instalación", "Obra", 10),
      def("3", "Responsable", "Obra", 20),
      def("4", "Color", "Acabados", 5),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.name, g.attributes.map((a) => a.title)]),
      [
        ["Acabados", ["Color", "Pintura"]],
        ["Obra", ["Fecha de instalación", "Responsable"]],
      ]
    );
  });
});
