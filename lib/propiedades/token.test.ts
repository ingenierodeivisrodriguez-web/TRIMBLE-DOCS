import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, httpApi } from "./client";
import { describeToken, expiresSoon, isTokenLike, tokenExpiresAt, tokenFrom } from "./token";

function jwt(payload: object): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.firma-de-prueba`;
}

const NOW = Date.UTC(2026, 9, 2, 2, 40);
const valid = jwt({ sub: "u1", exp: NOW / 1000 + 3600 });
const expired = jwt({ sub: "u1", exp: NOW / 1000 - 600 });

describe("token del usuario", () => {
  it("lee el token del evento en sus distintas formas", () => {
    assert.equal(tokenFrom(valid), valid);
    assert.equal(tokenFrom({ data: valid }), valid);
    assert.equal(tokenFrom({ accessToken: valid }), valid);
    assert.equal(tokenFrom({ data: { otro: 1 } }), "");
    assert.equal(tokenFrom(null), "");
  });

  it("nunca toma una palabra de estado como token", () => {
    for (const word of ["pending", "denied", "granted", "", "Pending"]) assert.equal(isTokenLike(word), false, word);
    assert.equal(isTokenLike(valid), true);
    assert.equal(isTokenLike("con espacios dentro de un texto largo"), false);
  });

  it("lee el vencimiento de un JWT", () => {
    assert.equal(tokenExpiresAt(valid), NOW + 3600 * 1000);
    assert.equal(tokenExpiresAt("no-es-un-jwt-pero-es-largo"), null);
    assert.equal(tokenExpiresAt("a.%%%.c"), null);
    assert.equal(expiresSoon(expired, NOW), true);
    assert.equal(expiresSoon(valid, NOW), false);
    assert.equal(expiresSoon("token-opaco-sin-vencimiento-legible", NOW), false);
  });

  it("describe el token sin mostrarlo", () => {
    const text = describeToken(expired, "solicitud de permiso", NOW);
    assert.match(text, /JWT/);
    assert.match(text, /venció el/);
    assert.match(text, /solicitud de permiso/);
    assert.ok(!text.includes(expired.split(".")[1]), "no debe incluir el contenido del token");
    assert.equal(describeToken("", "x", NOW), "no se recibió ningún token");
  });
});

describe("cliente HTTP: renovación del token", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(responses: { status: number; body: unknown }[]) {
    const sent: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent.push(String((init?.headers as Record<string, string>).Authorization));
      const r = responses.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    return sent;
  }

  it("tras un 401 pide el token de nuevo y repite la solicitud una vez", async () => {
    const sent = mockFetch([
      { status: 401, body: { error: "Trimble Connect no aceptó tu sesión", code: "trimble-session" } },
      { status: 200, body: { definitions: [], canEdit: true } },
    ]);
    const fresh = jwt({ exp: Date.now() / 1000 + 3600, n: 2 });
    const api = httpApi("proj1", { get: () => valid, refresh: async () => fresh });
    assert.deepEqual(await api.getCatalog(), { definitions: [], canEdit: true });
    assert.deepEqual(sent, [`Bearer ${valid}`, `Bearer ${fresh}`]);
  });

  it("renueva antes de enviar un token vencido", async () => {
    const sent = mockFetch([{ status: 200, body: { definitions: [], canEdit: false } }]);
    const fresh = jwt({ exp: Date.now() / 1000 + 3600, n: 3 });
    const api = httpApi("proj1", { get: () => expired, refresh: async () => fresh });
    await api.getCatalog();
    assert.deepEqual(sent, [`Bearer ${fresh}`]);
  });

  it("si vuelve a fallar, el error lleva el diagnóstico (sin el token)", async () => {
    mockFetch([
      { status: 401, body: { error: "Trimble Connect no aceptó tu sesión.", code: "trimble-session" } },
      { status: 401, body: { error: "Trimble Connect no aceptó tu sesión.", code: "trimble-session" } },
    ]);
    const api = httpApi("proj1", {
      get: () => valid,
      refresh: async () => valid,
      describe: () => "token JWT de 900 caracteres",
    });
    await assert.rejects(api.getCatalog(), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, "trimble-session");
      assert.match(err.message, /Diagnóstico: token JWT de 900 caracteres/);
      return true;
    });
  });

  it("no reintenta otros errores", async () => {
    const sent = mockFetch([{ status: 409, body: { error: "Tiene valores.", code: "has-values" } }]);
    const api = httpApi("proj1", { get: () => valid, refresh: async () => "otro-token-largo-xxxxxxxx" });
    await assert.rejects(api.deleteDefinition("a1"), /Tiene valores/);
    assert.equal(sent.length, 1);
  });
});
