import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as WebIFC from "web-ifc";
import { colorBase, conserva, cota, cotaIfc, opacidad, planoCorte, rangoIfc, rangosVertices } from "./herramientas";
import { armarModelo, elementoDeTriangulo, leerArchivo, ModeloRA, Vec3 } from "./modelo";
import { IFC_PRUEBA } from "./pruebas/ifcPrueba";

let modelo: ModeloRA;

before(async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const id = api.OpenModel(new TextEncoder().encode(IFC_PRUEBA), { COORDINATE_TO_ORIGIN: false });
  modelo = armarModelo([leerArchivo(api, id, 0)], { nivelesExcluidos: [], clasesExcluidas: [] });
  api.CloseModel(id);
});

/** An IFC point (metres, z up) in the model's frame. */
const deIfc = (p: Vec3): Vec3 => [p[0] - modelo.origen[0], p[2] - modelo.origen[1], -p[1] - modelo.origen[2]];
const cerca = (a: number, b: number) => Math.abs(a - b) < 1e-3;

describe("cotas del modelo", () => {
  it("el modelo de prueba va de X 1000 a 1004, Y 2000 a 2003 y Z 0 a 5.2 m", () => {
    const x = rangoIfc(modelo, "x");
    const y = rangoIfc(modelo, "y");
    const z = rangoIfc(modelo, "z");
    assert.ok(cerca(x.min, 1000) && cerca(x.max, 1004));
    assert.ok(cerca(y.min, 2000) && cerca(y.max, 2003));
    assert.ok(cerca(z.min, 0) && cerca(z.max, 5.2));
  });
  it("una cota IFC vuelve igual desde el marco del modelo", () => {
    const p: Vec3 = [1002.5, 2001.25, 3.2];
    assert.ok(cerca(cotaIfc("x", deIfc(p), modelo.origen), 1002.5));
    assert.ok(cerca(cotaIfc("y", deIfc(p), modelo.origen), 2001.25));
    assert.ok(cerca(cotaIfc("z", deIfc(p), modelo.origen), 3.2));
  });
  it("las cotas se leen con dos decimales y separador de miles", () => {
    assert.equal(cota(1002.5), "1,002.50 m");
  });
});

describe("cortes", () => {
  it("el corte horizontal a Z = 3.1 deja el muro (abajo) y quita la losa (3.0 a 3.2) por encima", () => {
    const p = planoCorte("z", 3.1, modelo.origen);
    assert.equal(conserva(p, deIfc([1001, 2001, 1.5])), true);
    assert.equal(conserva(p, deIfc([1001, 2001, 3.2])), false);
  });
  it("invertido, el corte horizontal deja lo de arriba", () => {
    const p = planoCorte("z", 3.1, modelo.origen, true);
    assert.equal(conserva(p, deIfc([1001, 2001, 1.5])), false);
    assert.equal(conserva(p, deIfc([1001, 2001, 4])), true);
  });
  it("el corte vertical en X = 1002 deja lo que está antes de X = 1002", () => {
    const p = planoCorte("x", 1002, modelo.origen);
    assert.equal(conserva(p, deIfc([1001.5, 2001, 1])), true);
    assert.equal(conserva(p, deIfc([1003, 2001, 1])), false);
  });
  it("el corte vertical en Y = 2001.5 deja lo que está antes de Y = 2001.5, y al invertir lo otro", () => {
    const p = planoCorte("y", 2001.5, modelo.origen);
    assert.equal(conserva(p, deIfc([1001, 2000.5, 1])), true);
    assert.equal(conserva(p, deIfc([1001, 2002.5, 1])), false);
    const q = planoCorte("y", 2001.5, modelo.origen, true);
    assert.equal(conserva(q, deIfc([1001, 2002.5, 1])), true);
  });
});

describe("transparencia", () => {
  it("baja la opacidad y nunca deja el modelo invisible (máximo 90 %)", () => {
    assert.equal(opacidad(1, 0), 1);
    assert.equal(opacidad(1, 0.5), 0.5);
    assert.equal(opacidad(0.8, 0.5), 0.4);
    assert.equal(opacidad(1, 1), 0.1);
  });
});

describe("colorear a mano", () => {
  it("los vértices de cada elemento no se cruzan con los de otro del mismo lote", () => {
    const blanco = modelo.lotes.find((l) => l.color[0] === 1 && l.color[1] === 1)!;
    const losa = modelo.elementos.findIndex((e) => e.nombre === "Losa 2");
    const viga = modelo.elementos.findIndex((e) => e.nombre === "Viga 1");
    const r1 = rangosVertices(blanco, losa);
    const r2 = rangosVertices(blanco, viga);
    assert.ok(r1.length > 0 && r2.length > 0);
    for (const [a, b] of r1) for (const [c, d] of r2) assert.ok(b <= c || d <= a, "rangos solapados");
  });
  it("los triángulos de un elemento solo usan vértices de su rango", () => {
    const blanco = modelo.lotes.find((l) => l.color[0] === 1 && l.color[1] === 1)!;
    const losa = modelo.elementos.findIndex((e) => e.nombre === "Losa 2");
    const [[a, b]] = rangosVertices(blanco, losa);
    for (let t = 0; t < blanco.indices.length / 3; t++) {
      if (elementoDeTriangulo(blanco, t) !== losa) continue;
      for (let k = 0; k < 3; k++) assert.ok(blanco.indices[t * 3 + k] >= a && blanco.indices[t * 3 + k] < b);
    }
  });
  it("un elemento que no está en el lote no tiene rangos", () => {
    const rojo = modelo.lotes.find((l) => l.color[1] === 0)!;
    assert.deepEqual(rangosVertices(rojo, modelo.elementos.findIndex((e) => e.nombre === "Losa 2")), []);
  });
  it("el blanco puro del IFC se muestra gris claro; los demás colores se respetan", () => {
    assert.deepEqual(colorBase([1, 1, 1, 1]), [0.82, 0.83, 0.85]);
    assert.deepEqual(colorBase([1, 0, 0, 1]), [1, 0, 0]);
  });
});

describe("estado de las herramientas", () => {
  it("empieza todo apagado, con el corte horizontal a la altura del QR", async () => {
    const { estadoInicial, planosActivos } = await import("./herramientas");
    const e = estadoInicial(modelo, deIfc([1002, 2000, 1.4]));
    assert.equal(e.corteH.activo, false);
    assert.equal(e.corteH.valor, 1.4);
    assert.equal(e.corteV.valor, 1002);
    assert.deepEqual(planosActivos(e, modelo.origen), []);
  });
  it("con los dos cortes activos hay dos planos", async () => {
    const { estadoInicial, planosActivos } = await import("./herramientas");
    const e = estadoInicial(modelo);
    e.corteH.activo = true;
    e.corteV = { ...e.corteV, activo: true, eje: "y" };
    assert.equal(planosActivos(e, modelo.origen).length, 2);
  });
});
