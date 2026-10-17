import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listaInsumos } from "../presupuesto/calc";
import { documentoVacio, resolverPresupuesto } from "../presupuesto/doc";
import { CONTEO, Componente, InsumoPresupuesto, Item, PresupuestoDoc, Subpartida } from "../presupuesto/types";
import { esDocumento, insumosPlanificados, metradosDelModelo, viaCompra } from "./planificado";

const ins = (codigo: string, descripcion: string, unidad: string, precio: number, tipo: InsumoPresupuesto["tipo"]): InsumoPresupuesto => ({
  codigo, descripcion, unidad, precio, tipo, iu: "", omniclass: "",
});
const crew = (id: string, cuadrilla: number): Componente => ({ tipo: "insumo", id, cuadrilla, cantidad: 0 });
const qty = (id: string, cantidad: number): Componente => ({ tipo: "insumo", id, cuadrilla: null, cantidad });
const sub = (id: string, cantidad: number): Componente => ({ tipo: "subpartida", id, cuadrilla: null, cantidad });
const P = (id: string, descripcion: string, unidad: string, componentes: Componente[], metrado: number, extra: Partial<Item> = {}): Item =>
  ({ id, tipo: "partida", nivel: 1, codigo: "", descripcion, unidad, omniclass: "", rendimiento: 20, jornada: 8, componentes, metrado, origenId: null, ...extra }) as Item;

/** A small budget: a slab (concrete subpartida + steel + crew + %MO tools) and a wall measured by the model. */
function presupuesto(): PresupuestoDoc {
  const doc = documentoVacio();
  doc.insumos = {
    cem: ins("MT-01", "CEMENTO GRIS", "BLS", 30_000, "MT"),
    are: ins("MT-02", "ARENA", "M3", 80_000, "MT"),
    ace: ins("MT-03", "ACERO 60000 PSI", "KG", 4_500, "MT"),
    blq: ins("MT-04", "BLOQUE No. 5", "UND", 2_100, "MT"),
    ofi: ins("MO-01", "OFICIAL", "HH", 12_000, "MO"),
    her: ins("EQ-01", "HERRAMIENTA MENOR", "%MO", 0, "EQ"),
    mez: ins("EQ-02", "MEZCLADORA", "DIA", 90_000, "EQ"),
    imp: ins("SC-01", "IMPERMEABILIZACIÓN", "M2", 25_000, "SC"),
    viejo: ins("MT-99", "YA NO SE USA", "UND", 1, "MT"),
  };
  const concreto: Subpartida = { codigo: "", descripcion: "CONCRETO 3000 PSI", unidad: "M3", omniclass: "", rendimiento: 1, jornada: 8, origenId: null, componentes: [qty("cem", 7), qty("are", 0.55)] };
  doc.subpartidas = { conc: concreto };
  doc.subpresupuestos[0].nombre = "ESTRUCTURA";
  doc.subpresupuestos[0].items = [
    { id: "t1", tipo: "titulo", nivel: 0, descripcion: "PISO 1" },
    P("losa", "LOSA E=15 CM", "M2", [sub("conc", 0.15), qty("ace", 12), crew("ofi", 2), qty("her", 5), crew("mez", 1)], 100),
    P("muro", "MURO EN BLOQUE", "M2", [qty("blq", 12.5), qty("cem", 0.2)], 10),
  ];
  doc.subpresupuestos.push({ id: "sp2", nombre: "CUBIERTA", pie: [], items: [P("imper", "IMPERMEABILIZACIÓN CUBIERTA", "M2", [qty("imp", 1)], 40), P("losa2", "LOSA CUBIERTA", "M2", [qty("ace", 10)], 0)] });
  return doc;
}

describe("metrado desde el modelo", () => {
  const doc = presupuesto();
  it("cuenta la suma o el número de elementos, y no cuando la partida está en manual o no se mide", () => {
    const m = metradosDelModelo(
      doc,
      [
        { itemId: "muro", campo: "Area", campoLabel: "Área", unidad: "M2" },
        { itemId: "imper", campo: CONTEO, campoLabel: "Elementos", unidad: "UND" },
        { itemId: "losa", campo: null, campoLabel: "", unidad: "" },
      ],
      [
        { itemId: "muro", elementos: 3, suma: 36.5 },
        { itemId: "imper", elementos: 4, suma: 0 },
        { itemId: "losa", elementos: 8, suma: 120 },
      ]
    );
    assert.deepEqual(m.get("muro"), { valor: 36.5, elementos: 3, campoLabel: "Área" });
    assert.equal(m.get("imper")?.valor, 4);
    assert.equal(m.has("losa"), false);

    const manual = structuredClone(doc);
    (manual.subpresupuestos[0].items[2] as { modo?: string }).modo = "manual";
    assert.equal(metradosDelModelo(manual, [{ itemId: "muro", campo: "Area", campoLabel: "Área", unidad: "M2" }], [{ itemId: "muro", elementos: 3, suma: 36.5 }]).has("muro"), false);
  });
});

describe("insumos planificados", () => {
  const doc = presupuesto();
  const modelo = metradosDelModelo(doc, [{ itemId: "muro", campo: "Area", campoLabel: "Área", unidad: "M2" }], [{ itemId: "muro", elementos: 3, suma: 36.5 }]);
  const { insumos, porcentaje } = insumosPlanificados(doc, modelo);
  const de = (id: string) => insumos.find((i) => i.id === id)!;

  it("da las mismas cantidades y montos que la Lista de insumos de Presupuesto (todos los subpresupuestos)", () => {
    const lista = listaInsumos(doc.subpresupuestos, resolverPresupuesto(doc), (id) => modelo.get(id) ?? null).filter((f) => !f.porcentaje);
    assert.deepEqual(
      insumos.map((i) => [i.id, i.cantidad, i.monto]),
      lista.map((f) => [f.id, f.cantidad, f.parcial])
    );
  });

  it("entra en las subpartidas y usa el metrado del modelo", () => {
    // Cement: slab 100 m2 × 0.15 m3 × 7 bls = 105, plus wall 36.5 m2 (model) × 0.2 = 7.3.
    assert.equal(de("cem").cantidad, 112.3);
    assert.equal(de("cem").codigo, "MT-01");
    assert.deepEqual(
      de("cem").usos.map((u) => [u.numero, u.subpresupuesto, u.metrado, u.desdeModelo, u.cantidad]),
      [
        ["1.1", "ESTRUCTURA", 100, false, 105],
        ["1.2", "ESTRUCTURA", 36.5, true, 7.3],
      ]
    );
    // Steel of the roof slab with metrado 0 needs nothing.
    assert.deepEqual(de("ace").usos.map((u) => u.itemId), ["losa"]);
    assert.equal(de("ace").cantidad, 1200);
  });

  it("los insumos en porcentaje no se compran y los que ya no se usan no aparecen", () => {
    assert.equal(insumos.some((i) => i.id === "her"), false);
    assert.deepEqual(porcentaje.map((p) => p.id), ["her"]);
    assert.ok(porcentaje[0].monto > 0);
    assert.equal(insumos.some((i) => i.id === "viejo"), false);
  });

  it("cada uso suma la cantidad planificada", () => {
    for (const i of insumos) {
      const suma = i.usos.reduce((s, u) => s + u.cantidad, 0);
      assert.ok(Math.abs(suma - i.cantidad) < 0.001, `${i.descripcion}: ${suma} vs ${i.cantidad}`);
    }
  });

  it("materiales y equipos van por orden de compra; subcontratos y mano de obra por contrato", () => {
    assert.equal(viaCompra("MT"), "orden");
    assert.equal(viaCompra("EQ"), "orden");
    assert.equal(viaCompra("SC"), "contrato");
    assert.equal(viaCompra("MO"), "contrato");
    assert.equal(de("mez").via, "orden");
    assert.equal(de("imp").via, "contrato");
  });

  it("reconoce un documento de presupuesto guardado", () => {
    assert.equal(esDocumento(doc), true);
    assert.equal(esDocumento({ subpresupuestos: "x" }), false);
    assert.equal(esDocumento(null), false);
  });
});
