import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calcularApu,
  calcularPie,
  calcularSubpresupuesto,
  cantidadComponente,
  cuadrillaPara,
  factorGastos,
  InsumoRef,
  listaInsumos,
  parcialGasto,
  redondear,
  Resolver,
  SubpartidaRef,
  totalGastos,
} from "./calc";
import { evaluarFormula, FormulaError } from "./formula";
import type { Componente, FilaPie, ItemPartida, Subpresupuesto } from "./types";

// The "TRAZO Y REPLANTEO" partida of the reference budget (rendimiento 50 M2/día).
const INSUMOS: Record<string, InsumoRef> = {
  topografo: { descripcion: "TOPOGRAFO", unidad: "HH", tipo: "MO", precio: 20.83 },
  capataz: { descripcion: "CAPATAZ", unidad: "HH", tipo: "MO", precio: 24.5 },
  oficial: { descripcion: "OFICIAL", unidad: "HH", tipo: "MO", precio: 15.94 },
  peon: { descripcion: "PEON", unidad: "HH", tipo: "MO", precio: 16.5 },
  clavos: { descripcion: 'CLAVOS 3"', unidad: "KG", tipo: "MT", precio: 4.5 },
  yeso: { descripcion: "YESO BOLSA 25 KG", unidad: "BLS", tipo: "MT", precio: 15 },
  wincha: { descripcion: "WINCHA", unidad: "UND", tipo: "MT", precio: 30 },
  madera: { descripcion: "MADERA TORNILLO", unidad: "P2", tipo: "MT", precio: 4.2 },
  pintura: { descripcion: "PINTURA ESMALTE", unidad: "GAL", tipo: "MT", precio: 47 },
  ocre: { descripcion: "OCRE ROJO", unidad: "KG", tipo: "MT", precio: 8 },
  mira: { descripcion: "MIRA TOPOGRAFICA", unidad: "HM", tipo: "EQ", precio: 1.2 },
  jalon: { descripcion: "JALON", unidad: "HM", tipo: "EQ", precio: 1 },
  teodolito: { descripcion: "TEODOLITO", unidad: "HM", tipo: "EQ", precio: 15 },
  herramientas: { descripcion: "HERRAMIENTAS MANUALES", unidad: "%MO", tipo: "EQ", precio: 0 },
  subcontrato: { descripcion: "MOVILIZACION", unidad: "GLB", tipo: "SC", precio: 10000 },
  cemento: { descripcion: "CEMENTO", unidad: "BOL", tipo: "MT", precio: 22.2 },
};

const crew = (id: string, cuadrilla: number): Componente => ({ tipo: "insumo", id, cuadrilla, cantidad: 0 });
const qty = (id: string, cantidad: number): Componente => ({ tipo: "insumo", id, cuadrilla: null, cantidad });

const TRAZO = {
  rendimiento: 50,
  jornada: 8,
  componentes: [
    crew("topografo", 1),
    crew("capataz", 0.1),
    crew("oficial", 1),
    crew("peon", 4),
    qty("clavos", 0.005),
    qty("yeso", 0.025),
    qty("wincha", 0.001),
    qty("madera", 0.0264),
    qty("pintura", 0.002),
    qty("ocre", 0.01),
    crew("mira", 1),
    crew("jalon", 2),
    crew("teodolito", 1),
    qty("herramientas", 5),
  ],
};

function resolver(subpartidas: Record<string, SubpartidaRef> = {}): Resolver {
  return { insumo: (id) => INSUMOS[id] ?? null, subpartida: (id) => subpartidas[id] ?? null };
}

function partida(id: string, nivel: number, metrado: number, apu: Pick<ItemPartida, "rendimiento" | "jornada" | "componentes">): ItemPartida {
  return { id, tipo: "partida", nivel, codigo: "", descripcion: id, unidad: "M2", omniclass: "", metrado, origenId: null, ...apu };
}

describe("redondeo", () => {
  it("redondea la mitad hacia afuera, sin errores binarios", () => {
    assert.equal(redondear(1.005, 2), 1.01);
    assert.equal(redondear(-1.005, 2), -1.01);
    assert.equal(redondear(0.0225, 2), 0.02); // clavos: 0.005 × 4.50
  });
});

describe("análisis de precios unitarios", () => {
  it("la cantidad de una cuadrilla es cuadrilla × jornada ÷ rendimiento", () => {
    assert.equal(cantidadComponente(crew("peon", 4), TRAZO), 0.64);
    assert.equal(cantidadComponente(crew("capataz", 0.1), TRAZO), 0.016);
    assert.equal(cuadrillaPara(0.64, TRAZO), 4);
  });

  it("reproduce el CU de Trazo y replanteo: MO 16.83, MT 0.71, EQ 3.75, CU 21.29", () => {
    const apu = calcularApu(TRAZO, resolver());
    assert.deepEqual(apu.rubros, { MO: 16.83, MT: 0.71, EQ: 3.75, SC: 0, SP: 0 });
    assert.equal(apu.cu, 21.29);
    const herramientas = apu.lineas.find((l) => l.descripcion === "HERRAMIENTAS MANUALES")!;
    assert.equal(herramientas.precio, 16.83); // the partida's labor
    assert.equal(herramientas.parcial, 0.84); // 5 % of it
    assert.deepEqual(
      apu.lineas.slice(0, 4).map((l) => [l.cantidad, l.parcial]),
      [
        [0.16, 3.33],
        [0.016, 0.39],
        [0.16, 2.55],
        [0.64, 10.56],
      ]
    );
  });

  it("una subpartida aporta su CU por la cantidad, y una circular no suma", () => {
    const subs: Record<string, SubpartidaRef> = {
      concreto: { descripcion: "CONCRETO", unidad: "M3", rendimiento: 1, jornada: 8, componentes: [qty("cemento", 9)] },
      loop: { descripcion: "LOOP", unidad: "M3", rendimiento: 1, jornada: 8, componentes: [{ tipo: "subpartida", id: "loop", cuadrilla: null, cantidad: 1 }] },
    };
    const apu = calcularApu(
      { rendimiento: 1, jornada: 8, componentes: [{ tipo: "subpartida", id: "concreto", cuadrilla: null, cantidad: 0.5 }] },
      resolver(subs)
    );
    assert.equal(apu.lineas[0].precio, 199.8); // 9 × 22.20
    assert.equal(apu.rubros.SP, 99.9);
    const loop = calcularApu(subs.loop, resolver(subs), { stack: ["loop"] });
    assert.equal(loop.cu, 0);
    assert.match(loop.lineas[0].error ?? "", /sí misma/);
  });

  it("un insumo que ya no existe se marca y no suma", () => {
    const apu = calcularApu({ rendimiento: 1, jornada: 8, componentes: [qty("borrado", 3), qty("cemento", 1)] }, resolver());
    assert.ok(apu.lineas[0].error);
    assert.equal(apu.cu, 22.2);
  });
});

describe("presupuesto", () => {
  const sp: Subpresupuesto = {
    id: "sp",
    nombre: "ESTRUCTURAS",
    pie: [],
    items: [
      { id: "t1", tipo: "titulo", nivel: 0, descripcion: "OBRAS PRELIMINARES" },
      partida("movilizacion", 1, 1, { rendimiento: 1, jornada: 8, componentes: [qty("subcontrato", 1)] }),
      partida("trazo", 1, 355, TRAZO),
      { id: "t2", tipo: "titulo", nivel: 0, descripcion: "DEMOLICIONES" },
      { id: "t21", tipo: "titulo", nivel: 1, descripcion: "MANUAL" },
      partida("cemento", 2, 2, { rendimiento: 1, jornada: 8, componentes: [qty("cemento", 1)] }),
    ],
  };

  it("numera, multiplica metrado × CU y suma los títulos por columnas", () => {
    const r = calcularSubpresupuesto(sp, resolver());
    assert.deepEqual(r.filas.map((f) => f.numero), ["1", "1.1", "1.2", "2", "2.1", "2.1.1"]);
    const trazo = r.filas[2];
    assert.equal(trazo.parcial, 7557.95);
    assert.deepEqual(trazo.rubros, { MO: 5974.65, MT: 252.05, EQ: 1331.25, SC: 0, SP: 0 });
    assert.equal(r.filas[0].parcial, 17557.95);
    assert.equal(r.filas[0].rubros.SC, 10000);
    assert.equal(r.filas[3].parcial, 44.4);
    assert.equal(r.filas[4].parcial, 44.4);
    assert.equal(r.cd, 17602.35);
  });

  it("usa el metrado del modelo cuando la partida mide sus elementos", () => {
    const r = calcularSubpresupuesto(sp, resolver(), (id) => (id === "cemento" ? { valor: 10.004, elementos: 4, campoLabel: "Volumen" } : null));
    assert.equal(r.filas[5].metrado, 10);
    assert.equal(r.filas[5].parcial, 222);
  });

  it("la lista de insumos suma metrado × cantidad, entrando en las subpartidas", () => {
    const subs: Record<string, SubpartidaRef> = {
      concreto: { descripcion: "CONCRETO", unidad: "M3", rendimiento: 1, jornada: 8, componentes: [qty("cemento", 9)] },
    };
    const conSub: Subpresupuesto = {
      ...sp,
      items: [...sp.items, partida("columna", 0, 3, { rendimiento: 1, jornada: 8, componentes: [{ tipo: "subpartida", id: "concreto", cuadrilla: null, cantidad: 0.5 }] })],
    };
    const lista = listaInsumos([conSub], resolver(subs));
    const cemento = lista.find((f) => f.id === "cemento")!;
    assert.equal(cemento.cantidad, 2 + 3 * 0.5 * 9);
    assert.equal(cemento.parcial, redondear(15.5 * 22.2, 2));
    const peon = lista.find((f) => f.id === "peon")!;
    assert.equal(peon.cantidad, 227.2); // 355 × 0.64
    const herramientas = lista.find((f) => f.id === "herramientas")!;
    assert.ok(herramientas.porcentajeMO);
    assert.equal(herramientas.parcial, 298.2); // 355 × 0.84
    assert.deepEqual([...new Set(lista.map((f) => f.tipo))], ["MO", "MT", "EQ", "SC"]);
  });
});

describe("gastos generales y pie", () => {
  it("parciales general y de personal", () => {
    const item = { id: "i", descripcion: "Ingeniero", unidad: "MES", cantidad: 2, precio: 5000, participacion: 50, tiempo: 6 };
    assert.equal(parcialGasto(item, "general"), 10000);
    assert.equal(parcialGasto(item, "personal"), 30000);
    const g = totalGastos({
      fijos: [{ id: "t", descripcion: "Propuesta", formato: "general", items: [
        { ...item, cantidad: 1, precio: 2000 },
        { ...item, cantidad: 1, precio: 700 },
        { ...item, cantidad: 1, precio: 100 },
      ] }],
      variables: [{ id: "v", descripcion: "Personal", formato: "personal", items: [item] }],
    });
    assert.deepEqual(g, { fijos: 2800, variables: 30000, total: 32800 });
    assert.equal(factorGastos(88842.62, 661051.39).toFixed(6), "0.134396");
  });

  it("reproduce el pie de ESTRUCTURAS: total 414,502.95", () => {
    const pie: FilaPie[] = [
      { variable: "PGG", descripcion: "GASTOS GENERALES 13.4396%", formula: "CD * 0.134396", iu: "39", resaltar: false },
      { variable: "UTI", descripcion: "UTILIDAD 10%", formula: "CD * 0.10", iu: "39", resaltar: false },
      { variable: "ST", descripcion: "SUB TOTAL", formula: "CD + PGG + UTI", iu: "", resaltar: true },
      { variable: "IGV", descripcion: "IGV 18%", formula: "ST * 0.18", iu: "", resaltar: false },
      { variable: "TOTAL", descripcion: "TOTAL PRESUPUESTO", formula: "ST + IGV", iu: "", resaltar: true },
    ];
    const r = calcularPie(pie, { cd: 284571.31, fgg: 0 });
    assert.deepEqual(r.map((f) => f.valor), [38245.25, 28457.13, 351273.69, 63229.26, 414502.95]);
    assert.ok(r.every((f) => f.error === null));
  });

  it("marca fórmulas con variables de abajo, repetidas o mal escritas", () => {
    const fila = (variable: string, formula: string): FilaPie => ({ variable, descripcion: "", formula, iu: "", resaltar: false });
    const r = calcularPie([fila("A", "B * 2"), fila("B", "CD"), fila("B", "1"), fila("CD", "1"), fila("C", "A + 1"), fila("D", "FGG * 100")], { cd: 10, fgg: 0.05 });
    assert.match(r[0].error!, /no existe/);
    assert.equal(r[1].valor, 10);
    assert.match(r[2].error!, /repetida/);
    assert.match(r[3].error!, /ya existe/);
    assert.match(r[4].error!, /tiene un error/);
    assert.equal(r[5].valor, 5);
  });
});

describe("fórmulas", () => {
  const vars = new Map([["CD", 100], ["ST", 50]]);
  it("respeta precedencia, paréntesis, signos y porcentajes", () => {
    assert.equal(evaluarFormula("CD + ST * 2", vars), 200);
    assert.equal(evaluarFormula("(cd + st) * 2", vars), 300);
    assert.equal(evaluarFormula("-CD + 18%", vars), -99.82);
    assert.equal(evaluarFormula("CD * 0,10", vars), 10);
    assert.equal(evaluarFormula("CD * 18%", vars), 18);
  });
  it("rechaza lo que no es una fórmula", () => {
    for (const bad of ["", "CD +", "CD * (2", "CD / 0", "alert(1)", "CD ST", "X + 1"]) {
      assert.throws(() => evaluarFormula(bad, vars), FormulaError, bad);
    }
  });
});
