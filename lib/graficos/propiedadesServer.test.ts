import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PAGE_SIZE, PropiedadesUnavailable, readPropiedadesPage } from "./propiedadesServer";

// A fake PostgREST over N value rows: honours offset/limit (capped at `maxRows`
// rows per response, like Supabase's max-rows) and Prefer: count=exact.
function fakeSupabase(rowCount: number, maxRows = 1000) {
  const calls: string[] = [];
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const headers = new Headers(init?.headers);
    if (url.pathname.endsWith("/propiedades_definiciones")) {
      return Response.json([{ id: "d1", title: "costo real", data_type: "number", group_name: "costo", sort_order: 10, active: true }]);
    }
    const offset = Number(url.searchParams.get("offset"));
    const limit = Math.min(Number(url.searchParams.get("limit")), maxRows);
    const rows = Array.from({ length: Math.max(0, Math.min(limit, rowCount - offset)) }, (_, i) => ({
      ifc_guid: `guid-${offset + i}`,
      attribute_id: "d1",
      value_text: null,
      value_number: offset + i,
      value_boolean: null,
      value_date: null,
    }));
    const range = rows.length ? `${offset}-${offset + rows.length - 1}` : "*";
    return Response.json(rows, {
      headers: headers.get("Prefer") === "count=exact" ? { "Content-Range": `${range}/${rowCount}` } : {},
    });
  };
  return { fetchFake, calls };
}

describe("readPropiedadesPage", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_de_prueba";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("reads a project's values page by page, with the catalog on the first page", async () => {
    const { fetchFake, calls } = fakeSupabase(PAGE_SIZE + 1234);
    globalThis.fetch = fetchFake as typeof fetch;
    const first = await readPropiedadesPage("_VFf6OdilsY", 0);
    assert.equal(first.definitions?.[0].title, "costo real");
    assert.equal(first.values.length, PAGE_SIZE);
    assert.equal(first.total, PAGE_SIZE + 1234);
    assert.equal(first.next, PAGE_SIZE);
    assert.deepEqual(first.values[7], { ifcGuid: "guid-7", attributeId: "d1", value: 7 });
    assert.ok(calls.every((c) => c.includes("project_id=eq._VFf6OdilsY")));

    const second = await readPropiedadesPage("_VFf6OdilsY", PAGE_SIZE);
    assert.equal(second.definitions, undefined);
    assert.equal(second.values.length, 1234);
    assert.equal(second.next, null);
    assert.equal(second.values[0].ifcGuid, `guid-${PAGE_SIZE}`);
  });

  it("never skips rows when Supabase answers fewer rows per request than asked", async () => {
    const { fetchFake } = fakeSupabase(2500, 300);
    globalThis.fetch = fetchFake as typeof fetch;
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await readPropiedadesPage("_VFf6OdilsY", offset);
      seen.push(...page.values.map((v) => v.ifcGuid));
      offset = page.next;
    }
    assert.equal(seen.length, 2500);
    assert.equal(new Set(seen).size, 2500);
  });

  it("handles a project without values", async () => {
    globalThis.fetch = fakeSupabase(0).fetchFake as typeof fetch;
    const page = await readPropiedadesPage("_VFf6OdilsY", 0);
    assert.deepEqual({ values: page.values, total: page.total, next: page.next }, { values: [], total: 0, next: null });
  });

  it("says when Propiedades has no database or no tables", async () => {
    delete process.env.SUPABASE_URL;
    await assert.rejects(readPropiedadesPage("_VFf6OdilsY", 0), PropiedadesUnavailable);
    process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
    globalThis.fetch = (async () =>
      new Response('{"code":"PGRST205","message":"Could not find the table"}', { status: 404 })) as typeof fetch;
    await assert.rejects(readPropiedadesPage("_VFf6OdilsY", 0), /supabase\/propiedades\.sql/);
  });
});
