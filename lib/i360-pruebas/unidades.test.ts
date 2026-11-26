import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aMetros, rad, unidadProbable } from "./unidades";

describe("unidadProbable (prueba de la Fase 0)", () => {
  it("una losa de 12 × 8 m en metros", () => {
    assert.equal(unidadProbable({ min: [0, 0, 14.9], max: [12, 8, 15.1] }), "m");
  });
  it("la misma losa en milímetros", () => {
    assert.equal(unidadProbable({ min: [0, 0, 14900], max: [12000, 8000, 15100] }), "mm");
  });
});

describe("aMetros", () => {
  it("convierte milímetros y deja igual los metros", () => {
    assert.deepEqual(aMetros([1500, -2000, 3000], "mm"), [1.5, -2, 3]);
    assert.deepEqual(aMetros([1.5, -2, 3], "m"), [1.5, -2, 3]);
  });
  it("rad: 90° = π/2", () => {
    assert.equal(rad(90), Math.PI / 2);
  });
});
