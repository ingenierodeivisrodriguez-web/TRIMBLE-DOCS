import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { camaraTrimble, diferenciaAngular, direccionCamara, esCaraDePiso } from "./camara";

describe("convención de la cámara del visor (medida en la Fase 0)", () => {
  it("la cámara real del informe: yaw −0,4656 y pitch 1,4725 miran a 63,3° y 5,6° hacia abajo", () => {
    const p = { x: -4.4495957729870925, y: -6.684751365065715, z: 2.7926577005130517 };
    const l = { x: -4.002800242176225, y: -5.795509013036501, z: 2.6945669618830146 };
    const d = direccionCamara(p, l);
    assert.ok(diferenciaAngular(d.azimut, (-0.465601836602553 * 180) / Math.PI + 90) < 0.1);
    assert.ok(Math.abs(d.elevacion - ((1.4725476016896288 * 180) / Math.PI - 90)) < 0.1);
  });

  it("los cuatro azimuts comprobados en Trimble: 0° → yaw −π/2, 90° → 0, 180° → π/2; horizontal → pitch π/2", () => {
    assert.ok(Math.abs(camaraTrimble(0).yaw + Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(camaraTrimble(90).yaw) < 1e-12);
    assert.ok(Math.abs(camaraTrimble(180).yaw - Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(camaraTrimble(0).pitch - Math.PI / 2) < 1e-12);
  });

  it("diferencia angular", () => {
    assert.equal(diferenciaAngular(359, 1), 2);
    assert.equal(diferenciaAngular(10, 350), 20);
  });

  it("cara de piso: normal hacia arriba (±15°)", () => {
    assert.equal(esCaraDePiso([0, 0, 1]), true);
    assert.equal(esCaraDePiso([0.2, 0, 0.98]), true);
    assert.equal(esCaraDePiso([1, 0, 0]), false);
    assert.equal(esCaraDePiso([0, 0, -1]), false);
    assert.equal(esCaraDePiso(null), false);
  });
});
