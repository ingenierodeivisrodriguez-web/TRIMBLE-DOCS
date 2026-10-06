import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bajar, desangrar, insertar, numerar, quitar, sangrar, subir, validarEsquema } from "./tree";
import type { Item } from "./types";

const T = (id: string, nivel: number): Item => ({ id, tipo: "titulo", nivel, descripcion: id });
const P = (id: string, nivel: number): Item => ({
  id,
  tipo: "partida",
  nivel,
  codigo: "",
  descripcion: id,
  unidad: "M2",
  omniclass: "",
  rendimiento: 1,
  jornada: 8,
  componentes: [],
  metrado: 1,
  origenId: null,
});

const shape = (items: Item[]) => items.map((i) => `${i.id}${i.nivel}`).join(" ");

// 1 A [1.1 a1, 1.2 a2], 2 B [2.1 C [2.1.1 c1], 2.2 b1]
const base = [T("A", 0), P("a1", 1), P("a2", 1), T("B", 0), T("C", 1), P("c1", 2), P("b1", 1)];

describe("esquema del presupuesto", () => {
  it("numera por niveles", () => {
    assert.deepEqual(numerar(base), ["1", "1.1", "1.2", "2", "2.1", "2.1.1", "2.2"]);
  });

  it("solo los títulos contienen filas", () => {
    assert.equal(validarEsquema(base), null);
    assert.match(validarEsquema([P("x", 0), P("y", 1)])!, /dentro de una partida/);
    assert.match(validarEsquema([T("x", 1)])!, /primer nivel/);
  });

  it("una partida nueva entra al final del título elegido; un título nuevo va después", () => {
    const conPartida = insertar(base, 0, [P("n", 0)]);
    assert.equal(shape(conPartida.items), "A0 a11 a21 n1 B0 C1 c12 b11");
    assert.equal(conPartida.index, 3);
    const conTitulo = insertar(base, 0, [T("n", 0)]);
    assert.equal(shape(conTitulo.items), "A0 a11 a21 n0 B0 C1 c12 b11");
    assert.equal(shape(insertar(base, 1, [P("n", 0)]).items), "A0 a11 n1 a21 B0 C1 c12 b11");
    assert.equal(shape(insertar(base, null, [P("n", 3)]).items), "A0 a11 a21 B0 C1 c12 b11 n0");
  });

  it("pega un bloque conservando su forma", () => {
    const pegado = insertar(base, 6, [T("X", 1), P("x1", 2)]);
    assert.equal(shape(pegado.items), "A0 a11 a21 B0 C1 c12 b11 X1 x12");
  });

  it("sangra dentro del título de arriba y desangra a continuación del padre", () => {
    assert.equal(sangrar(base, 1), null); // nothing above at its depth
    assert.equal(shape(sangrar(base, 3)!), "A0 a11 a21 B1 C2 c13 b12");
    assert.equal(sangrar(base, 2), null); // the row above is a partida
    const fuera = desangrar(base, 1)!;
    assert.equal(shape(fuera.items), "A0 a21 a10 B0 C1 c12 b11");
    assert.equal(fuera.index, 2);
    assert.equal(desangrar(base, 0), null);
  });

  it("sube y baja bloques enteros dentro de su título", () => {
    const arriba = subir(base, 3)!;
    assert.equal(shape(arriba.items), "B0 C1 c12 b11 A0 a11 a21");
    assert.equal(arriba.index, 0);
    assert.equal(subir(base, 4), null);
    const abajo = bajar(base, 4)!;
    assert.equal(shape(abajo.items), "A0 a11 a21 B0 b11 C1 c12");
    assert.equal(abajo.index, 5);
    assert.equal(bajar(base, 6), null);
  });

  it("quita un título con su contenido", () => {
    assert.equal(shape(quitar(base, 3)), "A0 a11 a21");
  });
});
