import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Caller,
  createDefinition,
  createSavedGrouping,
  deleteSavedGrouping,
  listSavedGroupings,
  deleteDefinition,
  editableAttributeIds,
  getCatalog,
  listContacts,
  queryValues,
  saveValues,
  ServiceError,
  updateDefinition,
} from "./service";
import { memoryStore } from "./store";

const admin: Caller = { id: "u1", name: "Ana Pérez (ana@obra.com)", isAdmin: true };
// Responsable of the "Obra" attributes in person and of "Calidad" through the group g-cal.
const user: Caller = {
  id: "u2",
  name: "Luis Gómez",
  isAdmin: false,
  memberOfGroups: async (ids) => new Set(ids.filter((id) => id === "g-cal")),
};
// A project member who isn't responsable of anything.
const outsider: Caller = { id: "u3", name: "Marta Ruiz", isAdmin: false, memberOfGroups: async () => new Set() };
const LUIS = { type: "user", id: "u2", name: "Luis Gómez" } as const;
const CALIDAD = { type: "group", id: "g-cal", name: "Calidad" } as const;
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
  const fecha = await createDefinition(store, admin, P, { title: "Fecha de instalación", dataType: "date", group: "Obra", responsables: [LUIS] });
  const avance = await createDefinition(store, admin, P, { title: "Avance (%)", dataType: "number", group: "Obra", responsables: [LUIS] });
  const listo = await createDefinition(store, admin, P, { title: "Inspeccionado", dataType: "boolean", group: "Calidad", responsables: [CALIDAD] });
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

describe("responsables", () => {
  const one = (attributeId: string, value: unknown) => ({
    elements: [{ ifcGuid: G1, modelId: "m1" }],
    changes: [{ attributeId, value }],
  });

  it("lets responsables (in person or through a group) and administrators assign values", async () => {
    const { store, fecha, listo } = await setup();
    await saveValues(store, user, P, one(fecha.id, "2026-05-20")); // in person
    await saveValues(store, user, P, one(listo.id, true)); // through the group
    await saveValues(store, admin, P, one(listo.id, false)); // administrators always
    assert.equal((await queryValues(store, P, { ifcGuids: [G1] })).length, 2);
  });

  it("refuses everyone else, without writing anything", async () => {
    const { store, fecha, avance } = await setup();
    await rejects(saveValues(store, outsider, P, one(fecha.id, "2026-05-20")), 403, "not-responsable");
    // one forbidden attribute stops the whole save
    const sinResponsables = await createDefinition(store, admin, P, { title: "Nota", dataType: "text" });
    await rejects(
      saveValues(store, user, P, {
        elements: [{ ifcGuid: G1, modelId: "m1" }],
        changes: [
          { attributeId: avance.id, value: 10 },
          { attributeId: sinResponsables.id, value: "hola" },
        ],
      }),
      403,
      "not-responsable"
    );
    assert.deepEqual(await queryValues(store, P, { ifcGuids: [G1] }), []);
  });

  it("tells each caller which attributes they can assign", async () => {
    const { store, fecha, avance, listo } = await setup();
    const nota = await createDefinition(store, admin, P, { title: "Nota", dataType: "text" });
    const ids = async (c: Caller) => new Set((await getCatalog(store, c, P)).editableIds);
    assert.deepEqual(await ids(admin), new Set([fecha.id, avance.id, listo.id, nota.id]));
    assert.deepEqual(await ids(user), new Set([fecha.id, avance.id, listo.id]));
    assert.deepEqual(await ids(outsider), new Set());
  });

  it("asks for group membership only when it matters", async () => {
    const { store, fecha, listo } = await setup();
    const asked: string[][] = [];
    const spy: Caller = { ...user, memberOfGroups: async (g) => (asked.push(g), new Set(g)) };
    const defs = (await getCatalog(store, admin, P)).definitions;
    await editableAttributeIds(spy, defs.filter((d) => d.id === fecha.id));
    assert.deepEqual(asked, []);
    await editableAttributeIds(spy, defs.filter((d) => d.id === listo.id));
    assert.deepEqual(asked, [["g-cal"]]);
  });

  it("validates and de-duplicates the list, and only administrators set it", async () => {
    const { store, fecha } = await setup();
    const updated = await updateDefinition(store, admin, P, fecha.id, { responsables: [LUIS, LUIS, CALIDAD] });
    assert.deepEqual(updated.responsables, [LUIS, CALIDAD]);
    await rejects(updateDefinition(store, admin, P, fecha.id, { responsables: [{ type: "empresa", id: "x", name: "X" }] }), 400);
    await rejects(updateDefinition(store, admin, P, fecha.id, { responsables: [{ type: "user", id: "../x", name: "X" }] }), 400);
    await rejects(updateDefinition(store, admin, P, fecha.id, { responsables: "Luis" }), 400);
    await rejects(updateDefinition(store, user, P, fecha.id, { responsables: [] }), 403, "not-admin");
    const cleared = await updateDefinition(store, admin, P, fecha.id, { responsables: [] });
    assert.deepEqual(cleared.responsables, []);
  });

  it("shows the contact list only to administrators", async () => {
    const contacts = { users: [], groups: [{ id: "g-cal", name: "Calidad", usersCount: 3 }] };
    assert.deepEqual(await listContacts(admin, async () => contacts), contacts);
    await rejects(listContacts(user, async () => contacts), 403, "not-admin");
  });
});

describe("configuraciones de agrupación guardadas", () => {
  const config = (name: string) => ({
    name,
    fields: [{ key: "Constraints · Level", label: "Level", group: "Constraints" }],
    modelNames: ["EST.rvt"],
  });

  it("cualquier miembro guarda; el nombre es único sin importar mayúsculas ni tildes", async () => {
    const store = memoryStore();
    const saved = await createSavedGrouping(store, outsider, P, config("Muros por nivel"));
    assert.equal(saved.canDelete, true);
    assert.equal(saved.createdBy, "Marta Ruiz");
    await rejects(createSavedGrouping(store, user, P, config("muros por NIVEL")), 409, "duplicate-name");
    await createSavedGrouping(store, user, "otroProyecto", config("Muros por nivel"));
    assert.equal((await listSavedGroupings(store, admin, P)).length, 1);
  });

  it("solo quien la guardó o un administrador la elimina", async () => {
    const store = memoryStore();
    const saved = await createSavedGrouping(store, outsider, P, config("Calidad"));
    const asUser = await listSavedGroupings(store, user, P);
    assert.equal(asUser[0].canDelete, false);
    assert.equal((await listSavedGroupings(store, admin, P))[0].canDelete, true);
    await rejects(deleteSavedGrouping(store, user, P, saved.id), 403, "not-owner");
    await deleteSavedGrouping(store, outsider, P, saved.id);
    assert.deepEqual(await listSavedGroupings(store, admin, P), []);
    await rejects(deleteSavedGrouping(store, admin, P, saved.id), 404);
  });

  it("valida nombre, campos y modelos", async () => {
    const store = memoryStore();
    await rejects(createSavedGrouping(store, user, P, { ...config("x"), name: "  " }), 400);
    await rejects(createSavedGrouping(store, user, P, { ...config("x"), fields: [] }), 400);
    const four = Array.from({ length: 4 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, group: "" }));
    await rejects(createSavedGrouping(store, user, P, { ...config("x"), fields: four }), 400);
    await rejects(createSavedGrouping(store, user, P, { ...config("x"), modelNames: "EST" }), 400);
    await rejects(deleteSavedGrouping(store, admin, P, "no-es-uuid"), 400);
  });
});
