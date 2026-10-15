import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccionAlCatalogo, CatalogoActual, cuEnCatalogo, guardadoAlCatalogo, planAlCatalogo, vincularAlCatalogo } from "./alCatalogo";
import { documentoVacio } from "./doc";
import type { Componente, Insumo, ItemPartida, PartidaCatalogo, PresupuestoDoc } from "./types";

const crew = (id: string, cuadrilla: number): Componente => ({ tipo: "insumo", id, cuadrilla, cantidad: 0 });
const qty = (id: string, cantidad: number): Componente => ({ tipo: "insumo", id, cuadrilla: null, cantidad });
const sub = (id: string, cantidad: number): Componente => ({ tipo: "subpartida", id, cuadrilla: null, cantidad });

const insumo = (id: string, descripcion: string, unidad: string, precio: number, codigo = ""): Insumo => ({
  id,
  codigo,
  descripcion,
  unidad,
  precio,
  tipo: unidad === "HH" ? "MO" : unidad === "%MO" ? "EQ" : "MT",
  iu: "",
  omniclass: "",
  updatedAt: null,
  updatedBy: null,
});

const partidaCat = (id: string, codigo: string, descripcion: string, componentes: Componente[], rendimiento = 10): PartidaCatalogo => ({
  id,
  codigo,
  descripcion,
  unidad: "M2",
  omniclass: "",
  rendimiento,
  jornada: 8,
  componentes,
  updatedAt: null,
  updatedBy: null,
});

const fila = (id: string, descripcion: string, componentes: Componente[], extra: Partial<ItemPartida> = {}): ItemPartida => ({
  id,
  tipo: "partida",
  nivel: 1,
  codigo: "",
  descripcion,
  unidad: "M2",
  omniclass: "",
  rendimiento: 10,
  jornada: 8,
  componentes,
  metrado: 0,
  origenId: null,
  ...extra,
});

function escenario() {
  const catalogo: CatalogoActual = {
    insumos: new Map([insumo("ofi", "OFICIAL", "HH", 20_000), insumo("cem", "CEMENTO GRIS", "BLS", 30_000, "I-1")].map((i) => [i.id, i])),
    partidas: new Map(
      [
        partidaCat("c2", "P-2", "PAÑETE", [crew("ofi", 1), qty("cem", 0.2)]),
        partidaCat("c3", "P-3", "ESTUCO", [crew("ofi", 1)]),
        partidaCat("c4", "P-4", "PINTURA", [crew("ofi", 1)]),
        partidaCat("csub", "S-1", "MORTERO 1:4", [qty("cem", 8)], 1),
      ].map((p) => [p.id, p])
    ),
  };
  const doc: PresupuestoDoc = {
    ...documentoVacio(),
    insumos: {
      ofi: { codigo: "", descripcion: "OFICIAL", unidad: "HH", precio: 25_000, tipo: "MO", iu: "", omniclass: "" }, // priced higher in this budget
      cem: { codigo: "I-1", descripcion: "CEMENTO GRIS", unidad: "BLS", precio: 30_000, tipo: "MT", iu: "", omniclass: "" },
      her: { codigo: "I-1", descripcion: "HERRAMIENTA MENOR", unidad: "%MO", precio: 0, tipo: "EQ", iu: "", omniclass: "" }, // not in the catalog; its code is taken
      cem2: { codigo: "", descripcion: "Cemento  gris", unidad: "bls", precio: 31_000, tipo: "MT", iu: "", omniclass: "" }, // the catalog's cement under another id
    },
    subpartidas: {
      s1: { codigo: "", descripcion: "CONCRETO 3000 PSI", unidad: "M3", omniclass: "", rendimiento: 1, jornada: 8, componentes: [qty("cem2", 7), crew("ofi", 2)], origenId: null },
      s2: { codigo: "S-1", descripcion: "MORTERO 1:4", unidad: "M3", omniclass: "", rendimiento: 1, jornada: 8, componentes: [qty("cem", 8)], origenId: "csub" },
    },
  };
  const apuP1 = [crew("ofi", 1), qty("her", 5), sub("s1", 0.1), sub("s2", 0.02), qty("borrado", 1)];
  const items = [
    fila("p1", "MURO EN BLOQUE", apuP1, { codigo: "P-2" }), // its code is another catalog partida's
    fila("p1b", "Muro en  bloque", apuP1), // the same one on the next floor
    fila("p1c", "MURO EN BLOQUE", apuP1, { rendimiento: 12 }), // same name, another analysis
    fila("p2", "PAÑETE", [crew("ofi", 1), qty("cem", 0.2)], { origenId: "c2", edt: { descripcion: "", criterios: "", responsable: "Ana" } }),
    fila("p3", "ESTUCO", [crew("ofi", 2)], { origenId: "c3" }),
    fila("p4", "PINTURA", [crew("ofi", 1)]), // no origin, but the catalog has it (with a code)
  ];
  doc.subpresupuestos[0].items = [{ id: "t", tipo: "titulo", nivel: 0, descripcion: "OBRA" }, ...items];
  let n = 0;
  const ids = () => `N${++n}`;
  return { catalogo, doc, items, ids };
}

describe("guardar partidas del presupuesto en el catálogo", () => {
  it("agrupa la misma partida, la compara con el catálogo y apunta sus líneas al catálogo", () => {
    const { catalogo, doc, items, ids } = escenario();
    const plan = planAlCatalogo(doc, items, catalogo, ids);
    assert.deepEqual(
      plan.filas.map((f) => [f.descripcion, f.itemIds.join(","), f.catalogoId, f.estado, f.distintasEnGrupo]),
      [
        ["MURO EN BLOQUE", "p1,p1b,p1c", null, "nueva", 1],
        ["PAÑETE", "p2", "c2", "igual", 0], // the person in charge doesn't count
        ["ESTUCO", "p3", "c3", "distinta", 0],
        ["PINTURA", "p4", "c4", "igual", 0], // the catalog's code fills the empty one
      ]
    );
    const muro = plan.filas[0];
    // The catalog's resources as they are; the missing one with its id; the subpartida copied from the catalog points at it; the new one gets an id.
    assert.deepEqual(muro.datos.componentes, [crew("ofi", 1), qty("her", 5), sub("N1", 0.1), sub("csub", 0.02)]);
    assert.equal(muro.lineasSinOrigen, 1); // "borrado"
    assert.deepEqual([...muro.insumos], ["her"]);
    assert.deepEqual([...muro.subpartidas], ["s1"]);
    // Inside the new subpartida, the budget's cement under another id is the catalog's.
    assert.deepEqual(plan.subpartidas.get("s1")!.datos.componentes, [qty("cem", 7), crew("ofi", 2)]);
  });

  it("calcula el costo unitario con los precios del catálogo", () => {
    const { catalogo, doc, items, ids } = escenario();
    const plan = planAlCatalogo(doc, items, catalogo, ids);
    // MO: 1 × 8 ÷ 10 = 0.8 HH × 20,000 (the catalog's price, not the budget's 25,000) = 16,000; EQ: 5 % = 800.
    // SP: concreto (7 × 30,000 + 2 × 8 ÷ 1 × 20,000 = 530,000) × 0.1 = 53,000 and mortero (240,000) × 0.02 = 4,800.
    const c = cuEnCatalogo(plan, plan.filas[0].datos, catalogo);
    assert.deepEqual(c.rubros, { MO: 16_000, MT: 0, EQ: 800, SC: 0, SP: 57_800 });
  });

  it("guarda solo lo elegido, con lo que necesita, sin repetir códigos y sin tocar lo que no se eligió", () => {
    const { catalogo, doc, items, ids } = escenario();
    const plan = planAlCatalogo(doc, items, catalogo, ids);
    const acciones = new Map<string, AccionAlCatalogo>(plan.filas.map((f) => [f.clave, f.estado === "distinta" ? "omitir" : f.estado === "igual" ? "actualizar" : "crear"]));
    const g = guardadoAlCatalogo(plan, acciones, catalogo, ids);
    assert.deepEqual(g.insumos, [{ ...doc.insumos.her, codigo: "", id: "her" }]);
    assert.deepEqual(
      g.partidas.map((p) => [p.id, p.codigo, p.descripcion]),
      [
        ["N1", "", "CONCRETO 3000 PSI"],
        ["N2", "", "MURO EN BLOQUE"],
      ]
    );
    assert.equal(g.avisos.length, 2); // the resource's code and the partida's
    assert.deepEqual([g.creadas, g.actualizadas], [1, 0]);
    // The rows of the group, and the ones already equal, now come from the catalog; ESTUCO stays as it was.
    assert.deepEqual(Object.fromEntries(g.items), { p1: "N2", p1b: "N2", p1c: "N2", p2: "c2", p4: "c4" });
    const nuevo = vincularAlCatalogo(doc, g);
    const origen = Object.fromEntries(nuevo.subpresupuestos[0].items.flatMap((i) => (i.tipo === "partida" ? [[i.id, i.origenId]] : [])));
    assert.deepEqual(origen, { p1: "N2", p1b: "N2", p1c: "N2", p2: "c2", p3: "c3", p4: "c4" });
    assert.equal(nuevo.subpartidas.s1.origenId, "N1");
  });

  it("al actualizar una partida del catálogo conserva su código y lo que el presupuesto no tiene", () => {
    const { catalogo, doc, items, ids } = escenario();
    const plan = planAlCatalogo(doc, items, catalogo, ids);
    const estuco = plan.filas.find((f) => f.descripcion === "ESTUCO")!;
    const g = guardadoAlCatalogo(plan, new Map([[estuco.clave, "actualizar"]]), catalogo, ids);
    assert.deepEqual(g.partidas, [{ ...estuco.datos, codigo: "P-3", id: "c3" }]);
    assert.deepEqual([g.insumos.length, g.creadas, g.actualizadas], [0, 0, 1]);
    // Or added as another partida, without the code the catalog's has.
    const otra = guardadoAlCatalogo(plan, new Map([[estuco.clave, "crear"]]), catalogo, ids);
    assert.deepEqual([otra.partidas[0].id === "c3", otra.creadas], [false, 1]);
  });
});
