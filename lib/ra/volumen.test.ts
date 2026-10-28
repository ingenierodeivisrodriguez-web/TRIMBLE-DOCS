import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aristasCaja, cuadriculaPiso, dentroEnPlanta, distanciaEnPlanta, esHorizontal, giroHaciaPersona, metros, VOLUMEN_PRUEBA } from "./volumen";

const largo = ([a, b]: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }]) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("volumen de prueba", () => {
  it("mide 2 × 2 × 3 m", () => {
    assert.deepEqual(VOLUMEN_PRUEBA, { ancho: 2, largo: 2, alto: 3 });
  });
  it("la caja tiene 12 aristas: 8 de 2 m y 4 verticales de 3 m", () => {
    const aristas = aristasCaja(VOLUMEN_PRUEBA);
    assert.equal(aristas.length, 12);
    const medidas = aristas.map(largo).sort((a, b) => a - b);
    assert.deepEqual(medidas, [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3]);
  });
  it("apoya en el piso y está centrada en el punto", () => {
    const puntos = aristasCaja(VOLUMEN_PRUEBA).flat();
    assert.equal(Math.min(...puntos.map((p) => p.y)), 0);
    assert.equal(Math.max(...puntos.map((p) => p.y)), 3);
    assert.equal(Math.min(...puntos.map((p) => p.x)), -1);
    assert.equal(Math.max(...puntos.map((p) => p.z)), 1);
  });
  it("la cuadrícula del piso marca cada metro por dentro (una línea en cada sentido para 2 × 2 m)", () => {
    const lineas = cuadriculaPiso(VOLUMEN_PRUEBA);
    assert.equal(lineas.length, 2);
    assert.ok(lineas.every((l) => largo(l) === 2));
  });
  it("en una base de 3 × 4 m salen 2 + 3 líneas", () => {
    assert.equal(cuadriculaPiso({ ancho: 3, largo: 4, alto: 3 }).length, 5);
  });
});

describe("colocación", () => {
  it("el frente mira a la persona: delante (+z) no gira", () => {
    assert.equal(giroHaciaPersona({ x: 0, z: 0 }, { x: 0, z: 5 }), 0);
  });
  it("con la persona a la derecha (+x) gira 90°", () => {
    assert.equal(giroHaciaPersona({ x: 0, z: 0 }, { x: 3, z: 0 }), Math.PI / 2);
  });
  it("con la persona detrás gira 180°", () => {
    assert.equal(Math.abs(giroHaciaPersona({ x: 1, z: 1 }, { x: 1, z: -2 })), Math.PI);
  });
  it("si la persona está justo en el punto no gira", () => {
    assert.equal(giroHaciaPersona({ x: 1, z: 1 }, { x: 1, z: 1 }), 0);
  });
  it("la distancia se mide en planta, sin la altura", () => {
    assert.equal(distanciaEnPlanta({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
  });
  it("dentro del volumen incluye el borde y excluye lo de afuera", () => {
    assert.equal(dentroEnPlanta({ x: 0, z: 0 }, VOLUMEN_PRUEBA), true);
    assert.equal(dentroEnPlanta({ x: 1, z: -1 }, VOLUMEN_PRUEBA), true);
    assert.equal(dentroEnPlanta({ x: 1.01, z: 0 }, VOLUMEN_PRUEBA), false);
  });
  it("solo acepta el piso: rechaza muros y superficies muy inclinadas", () => {
    const identidad = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const muro = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // y axis turned to +z
    const c = Math.cos((30 * Math.PI) / 180);
    const s = Math.sin((30 * Math.PI) / 180);
    const rampa30 = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
    assert.equal(esHorizontal(identidad), true);
    assert.equal(esHorizontal(muro), false);
    assert.equal(esHorizontal(rampa30), false);
    assert.equal(esHorizontal(rampa30, 35), true);
  });
  it("los metros se muestran con dos decimales", () => {
    assert.equal(metros(3.2), "3.20 m");
    assert.equal(metros(0.005), "0.01 m");
  });
});
