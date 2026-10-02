import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Caller,
  createDefinition,
  deleteDefinition,
  getCatalog,
  queryValues,
  saveValues,
  ServiceError,
  updateDefinition,
} from "./service";
import { memoryStore } from "./store";

const admin: Caller = { id: "u1", name: "Ana Pérez (ana@obra.com)", isAdmin: true };
const user: Caller = { id: "u2", name: "Luis Gómez", isAdmin: false };
const P = "proj1";
const G1 = "3CqVfw$t15ihB2vPgB1wri";
const G2 = "0000000000000000000000";

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

async function setup() {
  const store = memoryStore();
  const fecha = await createDefinition(store, admin, P, { title: "Fecha de instalación", dataType: "date", group: "Obra" });
  const avance = await createDefinition(store, admin, P, { title: "Avance (%)", dataType: "number", group: "Obra" });
  const listo = await createDefinition(store, admin, P, { title: "Inspeccionado", dataType: "boolean", group: "Calidad" });
  return { store, fecha, avance, listo };
}

describe("catalog", () => {
  it("lets only project administrators change it", async () => {
    const { store, fecha } = await setup();
    await rejects(createDefinition(store, user, P, { title: "Otro", dataType: "text" }), 403, "not-admin");
    await rejects(updateDefinition(store, user, P, fecha.id, { title: "X" }), 403);
    assert.equal((await getCatalog(store, user, P)).canEdit, false);
    assert.equal((await getCatalog(store, admin, P)).canEdit, true);
  });

  it("validates the definition and gives new ones the next display order", async () => {
    const { store, listo } = await setup();
    await rejects(createDefinition(store, admin, P, { title: " ", dataType: "text" }), 400);
    await rejects(createDefinition(store, admin, P, { title: "X", dataType: "lista" }), 400);
    const nueva = await createDefinition(store, admin, P, { title: "Responsable", dataType: "text" });
    assert.equal(nueva.group, "General");
    assert.equal(nueva.sortOrder, listo.sortOrder + 10);
  });

  it("refuses duplicate titles, ignoring case and accents", async () => {
    const { store } = await setup();
    await rejects(createDefinition(store, admin, P, { title: "fecha de instalacion", dataType: "date" }), 409, "duplicate-title");
  });

  it("deletes an unused definition but only deactivates one with values", async () => {
    const { store, fecha, avance } = await setup();
    await saveValues(store, user, P, { elements: [{ ifcGuid: G1, modelId: "m1" }], changes: [{ attributeId: fecha.id, value: "2026-05-20" }] });

    await rejects(deleteDefinition(store, admin, P, fecha.id), 409, "has-values");
    const off = await updateDefinition(store, admin, P, fecha.id, { active: false });
    assert.equal(off.active, false);
    // its values are kept and still queryable
    const values = await queryValues(store, P, { ifcGuids: [G1] });
    assert.deepEqual(values.map((v) => v.value), ["2026-05-20"]);

    await deleteDefinition(store, admin, P, avance.id);
    assert.equal((await getCatalog(store, admin, P)).definitions.some((d) => d.id === avance.id), false);
  });

  it("locks the data type once values exist", async () => {
    const { store, avance } = await setup();
    await saveValues(store, user, P, { elements: [{ ifcGuid: G1, modelId: "m1" }], changes: [{ attributeId: avance.id, value: 40 }] });
    await rejects(updateDefinition(store, admin, P, avance.id, { dataType: "text" }), 409, "type-locked");
  });
});

describe("values", () => {
  it("upserts several attributes on several elements and records who did it", async () => {
    const { store, fecha, avance, listo } = await setup();
    const result = await saveValues(store, user, P, {
      elements: [
        { ifcGuid: G1, modelId: "m1" },
        { ifcGuid: G2, modelId: "m1" },
        { ifcGuid: G1, modelId: "m1" },
      ],
      changes: [
        { attributeId: fecha.id, value: "2026-05-20" },
        { attributeId: avance.id, value: 75 },
        { attributeId: listo.id, value: true },
      ],
    });
    assert.deepEqual(result, { elements: 2, attributes: 3 });
    const values = await queryValues(store, P, { ifcGuids: [G1, G2] });
    assert.equal(values.length, 6);
    assert.ok(values.every((v) => v.updatedBy === "Luis Gómez"));
  });

  it("clears a value with null", async () => {
    const { store, avance } = await setup();
    const elements = [{ ifcGuid: G1, modelId: "m1" }];
    await saveValues(store, user, P, { elements, changes: [{ attributeId: avance.id, value: 10 }] });
    await saveValues(store, user, P, { elements, changes: [{ attributeId: avance.id, value: null }] });
    assert.deepEqual(await queryValues(store, P, { ifcGuids: [G1] }), []);
  });

  it("rejects values of the wrong type without writing anything", async () => {
    const { store, fecha, avance } = await setup();
    await rejects(
      saveValues(store, user, P, {
        elements: [{ ifcGuid: G1, modelId: "m1" }],
        changes: [
          { attributeId: avance.id, value: 10 },
          { attributeId: fecha.id, value: "20-05-2026" },
        ],
      }),
      400
    );
    assert.deepEqual(await queryValues(store, P, { ifcGuids: [G1] }), []);
  });

  it("rejects inactive attributes and malformed IFCGUIDs", async () => {
    const { store, fecha } = await setup();
    await updateDefinition(store, admin, P, fecha.id, { active: false });
    await rejects(
      saveValues(store, user, P, { elements: [{ ifcGuid: G1, modelId: "m1" }], changes: [{ attributeId: fecha.id, value: "2026-01-01" }] }),
      400,
      "inactive"
    );
    await rejects(queryValues(store, P, { ifcGuids: ["1234"] }), 400);
    await rejects(
      saveValues(store, user, P, { elements: [{ ifcGuid: "abc", modelId: "m" }], changes: [{ attributeId: fecha.id, value: null }] }),
      400
    );
  });

  it("keeps projects apart", async () => {
    const { store, avance } = await setup();
    await rejects(
      saveValues(store, user, "otroProyecto", { elements: [{ ifcGuid: G1, modelId: "m1" }], changes: [{ attributeId: avance.id, value: 1 }] }),
      400
    );
  });
});
