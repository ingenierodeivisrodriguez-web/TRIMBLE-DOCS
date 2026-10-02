import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyGroupResponsables, commonResponsables, describeResponsables, withCurrentNames } from "./responsables";
import type { AttributeDefinition, Responsable } from "./types";

const DAVID: Responsable = { type: "user", id: "u1", name: "David Pérez" };
const ANA: Responsable = { type: "user", id: "u2", name: "Ana Ruiz" };
const CALIDAD: Responsable = { type: "group", id: "g1", name: "Calidad" };

function def(id: string, responsables: Responsable[]): AttributeDefinition {
  return {
    id,
    projectId: "p",
    title: id,
    dataType: "text",
    group: "calidad",
    sortOrder: 0,
    active: true,
    valueCount: 0,
    responsables,
    updatedAt: "",
    updatedBy: null,
  };
}

describe("responsables de un grupo", () => {
  it("son los que comparten todos sus atributos", () => {
    assert.deepEqual(commonResponsables([def("a", [DAVID, CALIDAD]), def("b", [CALIDAD, DAVID, ANA])]), [DAVID, CALIDAD]);
    assert.deepEqual(commonResponsables([def("a", [DAVID]), def("b", [ANA])]), []);
    assert.deepEqual(commonResponsables([]), []);
  });

  it("agregar o quitar en el grupo cambia todos sus atributos y respeta los asignados a uno solo", () => {
    const defs = [def("a", [DAVID]), def("b", [DAVID, ANA]), def("c", [])];
    // the group had David in common... except "c", so nothing is common
    const before = commonResponsables(defs);
    assert.deepEqual(before, []);
    const changes = applyGroupResponsables(defs, before, [CALIDAD]);
    assert.deepEqual(changes, [
      { id: "a", responsables: [DAVID, CALIDAD] },
      { id: "b", responsables: [DAVID, ANA, CALIDAD] },
      { id: "c", responsables: [CALIDAD] },
    ]);

    const after = defs.map((d) => def(d.id, changes.find((c) => c.id === d.id)!.responsables));
    // taking Calidad out of the group leaves Ana (only on "b") and David where he was
    assert.deepEqual(applyGroupResponsables(after, [CALIDAD], []), [
      { id: "a", responsables: [DAVID] },
      { id: "b", responsables: [DAVID, ANA] },
      { id: "c", responsables: [] },
    ]);
  });

  it("no toca los atributos que ya estaban así", () => {
    const defs = [def("a", [CALIDAD]), def("b", [CALIDAD])];
    assert.deepEqual(applyGroupResponsables(defs, [CALIDAD], [CALIDAD]), []);
  });
});

describe("nombres", () => {
  it("usa el nombre actual de la lista de contactos", () => {
    const contacts = {
      users: [{ id: "u1", name: "David A. Pérez", email: "d@x.co", pending: false }],
      groups: [{ id: "g1", name: "Control de calidad", usersCount: 4 }],
    };
    assert.deepEqual(
      withCurrentNames([DAVID, CALIDAD, ANA], contacts).map((r) => r.name),
      ["David A. Pérez", "Control de calidad", "Ana Ruiz"]
    );
    assert.deepEqual(withCurrentNames([DAVID], null), [DAVID]);
  });

  it("los describe en una frase", () => {
    assert.equal(describeResponsables([]), "");
    assert.equal(describeResponsables([DAVID]), "David Pérez");
    assert.equal(describeResponsables([DAVID, CALIDAD]), "David Pérez y el grupo Calidad");
    assert.equal(describeResponsables([DAVID, ANA, CALIDAD]), "David Pérez, Ana Ruiz y el grupo Calidad");
  });
});
