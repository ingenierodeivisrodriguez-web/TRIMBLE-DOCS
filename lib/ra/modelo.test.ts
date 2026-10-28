import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, before } from "node:test";
import * as WebIFC from "web-ifc";
import { comprimir, desempaquetar, descomprimir, empaquetar } from "./formato";
import { revisarTamano, tamanoLegible } from "./limites";
import {
  ArchivoLeido,
  armarModelo,
  CLASES_EXCLUIDAS_INICIALES,
  elementoDeTriangulo,
  IFCBUILDINGSTOREY,
  IFCRELAGGREGATES,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  inventario,
  leerArchivo,
  Pieza,
  triangulosCon,
} from "./modelo";
import { IFC_PRUEBA } from "./pruebas/ifcPrueba";

const SIN_FILTRO = { nivelesExcluidos: [], clasesExcluidas: [] };
const cerca = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

let leido: ArchivoLeido;

before(async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const id = api.OpenModel(new TextEncoder().encode(IFC_PRUEBA), { COORDINATE_TO_ORIGIN: false });
  leido = leerArchivo(api, id, 0);
  api.CloseModel(id);
});

describe("lectura del IFC (web-ifc real)", () => {
  it("los códigos de tipo coinciden con los de web-ifc", () => {
    assert.equal(IFCRELCONTAINEDINSPATIALSTRUCTURE, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    assert.equal(IFCRELAGGREGATES, WebIFC.IFCRELAGGREGATES);
    assert.equal(IFCBUILDINGSTOREY, WebIFC.IFCBUILDINGSTOREY);
  });
  it("lee muro, losa y viga con su IFCGUID, clase y nombre (el espacio no trae geometría)", () => {
    const resumen = leido.elementos.map((e) => [e.clase, e.guid, e.nombre]).sort();
    assert.deepEqual(resumen, [
      ["IfcBeam", "CYvctVUKr0kugbFTf53O9L", "Viga 1"],
      ["IfcSlab", "AYvctVUKr0kugbFTf53O9L", "Losa 2"],
      ["IfcWall", "8YvctVUKr0kugbFTf53O9L", "Muro 1"],
    ]);
  });
  it("cada elemento queda en su nivel; la viga lo hereda del ensamble", () => {
    const nivel = Object.fromEntries(leido.elementos.map((e) => [e.nombre, e.nivel]));
    assert.deepEqual(nivel, { "Muro 1": "Piso 1", "Losa 2": "Piso 2", "Viga 1": "Piso 2" });
  });
  it("el origen se toma en metros enteros cerca del modelo (sitio en 1000 m, 2000 m)", () => {
    // web-ifc frame: IFC y (north) goes to -z.
    assert.equal(leido.origen[0], 1000);
    assert.equal(leido.origen[2], -2000);
  });
  it("las medidas salen en metros aunque el IFC esté en milímetros: el muro mide 4 × 0.2 × 3 m", () => {
    const muro = leido.elementos.find((e) => e.nombre === "Muro 1")!;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of muro.piezas) {
      for (let k = 0; k < p.posiciones.length; k += 3) {
        for (let e = 0; e < 3; e++) {
          min[e] = Math.min(min[e], p.posiciones[k + e]);
          max[e] = Math.max(max[e], p.posiciones[k + e]);
        }
      }
    }
    assert.ok(cerca(max[0] - min[0], 4) && cerca(max[1] - min[1], 3) && cerca(max[2] - min[2], 0.2), `${min} ${max}`);
  });
  it("conserva el color del IFC (muro rojo)", () => {
    const muro = leido.elementos.find((e) => e.nombre === "Muro 1")!;
    assert.deepEqual(muro.piezas[0].color, [1, 0, 0, 1]);
  });
});

describe("filtros y armado", () => {
  it("el inventario cuenta elementos por nivel y por clase", () => {
    const inv = inventario([leido]);
    assert.deepEqual(inv.niveles.map((n) => [n.nombre, n.elementos]), [["Piso 1", 1], ["Piso 2", 2]]);
    assert.deepEqual(inv.clases.map((c) => c.nombre), ["IfcBeam", "IfcSlab", "IfcWall"]);
  });
  it("sin filtro entran los 3 elementos, en un lote por color (rojo y blanco)", () => {
    const m = armarModelo([leido], SIN_FILTRO);
    assert.equal(m.elementos.length, 3);
    assert.equal(m.lotes.length, 2);
    assert.equal(m.triangulos, triangulosCon([leido], SIN_FILTRO));
  });
  it("excluir un nivel deja fuera sus elementos", () => {
    const m = armarModelo([leido], { nivelesExcluidos: ["Piso 2"], clasesExcluidas: [] });
    assert.deepEqual(m.elementos.map((e) => e.nombre), ["Muro 1"]);
  });
  it("excluir una clase deja fuera sus elementos", () => {
    const m = armarModelo([leido], { nivelesExcluidos: [], clasesExcluidas: ["IfcWall"] });
    assert.deepEqual(m.elementos.map((e) => e.nombre).sort(), ["Losa 2", "Viga 1"]);
    assert.ok(CLASES_EXCLUIDAS_INICIALES.includes("IfcSpace"));
  });
  it("si todo queda fuera, no hay triángulos y no se deja enviar", () => {
    const m = armarModelo([leido], { nivelesExcluidos: ["Piso 1", "Piso 2"], clasesExcluidas: [] });
    assert.equal(m.triangulos, 0);
    assert.equal(revisarTamano(m.triangulos, 100).puede, false);
  });
  it("la caja del modelo va del piso del muro a la cara superior de la viga (0 a 5.2 m)", () => {
    const m = armarModelo([leido], SIN_FILTRO);
    // Relative to the origin; back in model coordinates it is 0 to 5.2 m.
    assert.ok(cerca(m.min[1] + m.origen[1], 0) && cerca(m.max[1] + m.origen[1], 5.2), `${m.origen} ${m.min} ${m.max}`);
  });
  it("cada triángulo sabe de qué elemento es", () => {
    const m = armarModelo([leido], SIN_FILTRO);
    const blanco = m.lotes.find((l) => l.color[1] === 1)!;
    const nombres = new Set<string>();
    for (let t = 0; t < blanco.indices.length / 3; t++) nombres.add(m.elementos[elementoDeTriangulo(blanco, t)].nombre);
    assert.deepEqual([...nombres].sort(), ["Losa 2", "Viga 1"]);
    assert.equal(elementoDeTriangulo(blanco, blanco.indices.length / 3), -1);
  });
  it("un segundo archivo con otro origen se mueve al origen del primero", () => {
    const pieza: Pieza = { color: [0, 0, 1, 1], posiciones: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normales: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    const otro: ArchivoLeido = { origen: [1010, 0, -2000], elementos: [{ guid: "X", clase: "IfcColumn", nombre: "C1", nivel: "Piso 1", archivo: 1, piezas: [pieza], triangulos: 1 }] };
    const m = armarModelo([leido, otro], SIN_FILTRO);
    const azul = m.lotes.find((l) => l.color[2] === 1 && l.color[0] === 0)!;
    assert.equal(azul.posiciones[0], 1010 - leido.origen[0]);
    assert.equal(m.elementos.at(-1)!.archivo, 1);
  });
});

describe("archivo para el celular", () => {
  it("empaquetar y desempaquetar devuelve el mismo modelo", async () => {
    const m = armarModelo([leido], SIN_FILTRO);
    const bytes = await comprimir(empaquetar(m));
    const vuelta = desempaquetar(await descomprimir(bytes));
    assert.deepEqual(vuelta.elementos, m.elementos);
    assert.deepEqual(vuelta.origen, m.origen);
    assert.equal(vuelta.triangulos, m.triangulos);
    assert.equal(vuelta.lotes.length, m.lotes.length);
    vuelta.lotes.forEach((l, i) => {
      assert.deepEqual([...l.posiciones], [...m.lotes[i].posiciones]);
      assert.deepEqual([...l.normales], [...m.lotes[i].normales]);
      assert.deepEqual([...l.indices], [...m.lotes[i].indices]);
      assert.deepEqual([...l.tramos], [...m.lotes[i].tramos]);
      assert.deepEqual(l.color, m.lotes[i].color);
    });
  });
  it("rechaza un archivo que no es un modelo", () => {
    assert.throws(() => desempaquetar(new TextEncoder().encode("PK\u0003\u0004 otra cosa")), /no es un modelo/);
  });
  it("rechaza un archivo cortado", () => {
    const bytes = empaquetar(armarModelo([leido], SIN_FILTRO));
    assert.throws(() => desempaquetar(bytes.subarray(0, bytes.length - 8)), /incompleto/);
  });
});

describe("límites de tamaño", () => {
  it("un modelo normal pasa sin aviso", () => {
    assert.deepEqual(revisarTamano(200_000, 5_000_000), { puede: true, aviso: null });
  });
  it("más de un millón de triángulos pasa con aviso de lentitud", () => {
    const r = revisarTamano(1_500_000, 20_000_000);
    assert.equal(r.puede, true);
    assert.match(r.aviso!, /lento/);
  });
  it("más de tres millones de triángulos no se deja enviar", () => {
    assert.equal(revisarTamano(3_000_001, 1).puede, false);
  });
  it("un archivo de más de 50 MB no se deja enviar", () => {
    const r = revisarTamano(10, 51 * 1024 * 1024);
    assert.equal(r.puede, false);
    assert.match(r.aviso!, /51.0 MB/);
  });
  it("los tamaños se leen en KB o MB", () => {
    assert.equal(tamanoLegible(2048), "2 KB");
    assert.equal(tamanoLegible(3.5 * 1024 * 1024), "3.5 MB");
  });
});

describe("motor del navegador", () => {
  it("el web-ifc.wasm publicado es el mismo del paquete instalado", () => {
    const publicado = readFileSync(new URL("../../public/web-ifc/web-ifc.wasm", import.meta.url));
    const paquete = readFileSync(new URL("../../node_modules/web-ifc/web-ifc.wasm", import.meta.url));
    assert.ok(publicado.equals(paquete), "Copie node_modules/web-ifc/web-ifc.wasm a public/web-ifc/ (cambió la versión de web-ifc).");
  });
});
