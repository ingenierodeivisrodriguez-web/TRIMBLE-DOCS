import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aMetros, camaraTrimble, diferenciaAngular, direccionCamara, rad, unidadProbable } from "./unidades";

describe("convención de la cámara del visor (medida en la primera prueba real)", () => {
  it("la cámara de la prueba: yaw −0,4656 y pitch 1,4725 miran a 63,3° y 5,6° hacia abajo", () => {
    // camaraAntes del informe del 26-11-2026
    const p = { x: -4.4495957729870925, y: -6.684751365065715, z: 2.7926577005130517 };
    const l = { x: -4.002800242176225, y: -5.795509013036501, z: 2.6945669618830146 };
    const d = direccionCamara(p, l);
    assert.ok(diferenciaAngular(d.azimut, (-0.465601836602553 * 180) / Math.PI + 90) < 0.1);
    assert.ok(Math.abs(d.elevacion - ((1.4725476016896288 * 180) / Math.PI - 90)) < 0.1);
  });
  it("azimut 0° y horizontal → yaw −π/2, pitch π/2", () => {
    const c = camaraTrimble(0);
    assert.ok(Math.abs(c.yaw + Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(c.pitch - Math.PI / 2) < 1e-12);
  });
  it("mirando hacia abajo (−90°) → pitch 0, como devolvió el visor con pitch 0", () => {
    assert.equal(camaraTrimble(90, -90).pitch, 0);
  });
  it("diferenciaAngular: 359° y 1° están a 2°", () => {
    assert.equal(diferenciaAngular(359, 1), 2);
    assert.equal(diferenciaAngular(10, 350), 20);
  });
});

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
