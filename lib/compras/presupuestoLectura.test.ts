import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { supabaseLectura } from "./presupuestoLectura";

describe("lectura del presupuesto", () => {
  const original = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  afterEach(() => {
    globalThis.fetch = original.fetch;
    process.env.SUPABASE_URL = original.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  });

  it("solo hace consultas GET a las tablas de Presupuesto (nunca escribe)", async () => {
    process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prueba";
    const llamadas: { url: string; method: string }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      llamadas.push({ url: String(url), method: init.method ?? "GET" });
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const l = supabaseLectura()!;
    assert.equal(await l.documento("obra1"), null);
    assert.deepEqual(await l.mediciones("obra1"), []);
    assert.deepEqual(await l.resumenElementos("obra1"), []);
    assert.equal(llamadas.length, 3);
    for (const c of llamadas) {
      assert.equal(c.method, "GET");
      assert.match(c.url, /\/rest\/v1\/presupuesto_(documentos|mediciones|resumen_elementos)\?project_id=eq\.obra1&/);
    }
  });
});
