import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aModelo, calibrar, codigoDeLectura, deMatriz, esMuroAR, girar, normalizar } from "./calibracion";
import type { Vec3 } from "./modelo";

const cerca = (a: Vec3, b: Vec3, tol = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) <= tol);

describe("muro en la cámara", () => {
  it("una superficie vertical es muro; el piso y el techo no", () => {
    assert.equal(esMuroAR([0, 0, 1]), true);
    assert.equal(esMuroAR([0.7, 0.1, -0.7]), true);
    assert.equal(esMuroAR([0, 1, 0]), false);
    assert.equal(esMuroAR([0, -1, 0]), false);
    assert.equal(esMuroAR([0.7, 0.7, 0]), false);
  });
  it("de la matriz del toque salen el punto (columna 4) y la normal (eje y)", () => {
    const m = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 2, 1.4, -3, 1];
    assert.deepEqual(deMatriz(m), { punto: [2, 1.4, -3], normal: [0, 0, 1] });
  });
});

describe("calibrar con la cruz del muro", () => {
  it("si el muro real mira igual que en el modelo, no gira y solo se corre", () => {
    const c = calibrar([2, 1.4, 0], 0, [10, 1.5, -4], [0, 0, 1]);
    assert.equal(c.giro, 0);
    assert.ok(cerca(c.traslado, [8, 0.1, -4], 1e-12));
  });
  it("el punto del modelo cae exactamente sobre la cruz tocada, con cualquier giro", () => {
    for (const [rumbo, normal] of [
      [0, [1, 0, 0]],
      [Math.PI / 2, [0, 0, -1]],
      [-2.4, [-0.6, 0.05, 0.8]],
    ] as [number, Vec3][]) {
      const puntoModelo: Vec3 = [4.4, 1.415, 4.42];
      const cruz: Vec3 = [0.3, 1.2, -2.1];
      const c = calibrar(puntoModelo, rumbo, cruz, normal);
      const t = girar(puntoModelo, c.giro);
      assert.ok(cerca([t[0] + c.traslado[0], t[1] + c.traslado[1], t[2] + c.traslado[2]], cruz));
    }
  });
  it("la cara del muro del modelo queda mirando hacia donde mira el muro real", () => {
    const rumbo = Math.PI / 2; // the wall face looks to +x in the model
    const c = calibrar([0, 0, 0], rumbo, [0, 0, 0], [0, 0, -1]); // the real one looks to -z
    const mirada = girar([Math.sin(rumbo), 0, Math.cos(rumbo)], c.giro);
    assert.ok(cerca(mirada, [0, 0, -1], 1e-12));
  });
  it("una normal un poco inclinada no cambia el giro", () => {
    assert.equal(calibrar([0, 0, 0], 0, [0, 0, 0], [1, 0.2, 0]).giro, Math.PI / 2);
  });
  it("volver del celular al modelo da el punto de partida", () => {
    const c = calibrar([4, 1.4, 2], 1, [3, 1, -5], [0.5, 0, 0.5]);
    const p: Vec3 = [1.2, 1.6, 0.4];
    const t = girar(p, c.giro);
    assert.ok(cerca(aModelo([t[0] + c.traslado[0], t[1] + c.traslado[1], t[2] + c.traslado[2]], c), p, 1e-12));
  });
  it("los ángulos quedan entre -180° y 180°", () => {
    assert.equal(normalizar(3 * Math.PI), Math.PI);
    assert.ok(Math.abs(normalizar(-3 * Math.PI / 2) - Math.PI / 2) < 1e-12);
  });
});

describe("lectura del QR en el celular", () => {
  const origenes = ["https://trimble-docs.vercel.app"];
  it("acepta el enlace de un QR de esta aplicación", () => {
    assert.equal(codigoDeLectura("https://trimble-docs.vercel.app/ra/q/AbCdEfGhIjKlMnOpQrStUv", origenes), "AbCdEfGhIjKlMnOpQrStUv");
  });
  it("rechaza otro sitio, otra ruta o un texto cualquiera", () => {
    assert.equal(codigoDeLectura("https://otro-sitio.com/ra/q/AbCdEfGhIjKlMnOpQrStUv", origenes), null);
    assert.equal(codigoDeLectura("https://trimble-docs.vercel.app/presupuesto", origenes), null);
    assert.equal(codigoDeLectura("WIFI:S:obra;P:1234;;", origenes), null);
    assert.equal(codigoDeLectura("https://trimble-docs.vercel.app/ra/q/corto", origenes), null);
  });
});
