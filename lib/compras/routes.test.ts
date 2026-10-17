import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { handle } from "./routes";

describe("preámbulo de las rutas de Compras", () => {
  const nunca = async () => {
    throw new Error("no debía llegar aquí");
  };

  it("sin projectId o con uno no válido responde 400", async () => {
    const r1 = await handle(new NextRequest("http://localhost/api/compras/estado"), nunca);
    assert.equal(r1.status, 400);
    const r2 = await handle(new NextRequest("http://localhost/api/compras/estado?projectId=a%20b"), nunca);
    assert.equal(r2.status, 400);
  });

  it("sin el token de Trimble responde 401 y no consulta nada", async () => {
    const r = await handle(new NextRequest("http://localhost/api/compras/estado?projectId=_VFf6OdilsY"), async () => NextResponse.json({}));
    assert.equal(r.status, 401);
  });
});
