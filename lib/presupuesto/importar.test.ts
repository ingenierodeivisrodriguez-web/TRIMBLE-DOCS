import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcularApu } from "./calc";
import { documentoVacio, importarApu, limpiarDocumento, partidaDesdeCatalogo, resolverCatalogo, resolverPresupuesto } from "./doc";
import { planificarImportacion, tipoDe } from "./importar";
import type { Insumo, PartidaCatalogo } from "./types";

const ins = (id: string, codigo: string, descripcion: string, unidad: string, precio: number, tipo: Insumo["tipo"]): Insumo => ({
  id,
  codigo,
  descripcion,
  unidad,
  precio,
  tipo,
  iu: "",
  omniclass: "",
  updatedAt: null,
  updatedBy: null,
});
const PEON = ins("i-peon", "MO-001", "PEON", "HH", 16.5, "MO");
const CEMENTO = ins("i-cem", "", "CEMENTO", "BOL", 22.2, "MT");

describe("importación desde Excel", () => {
  it("reconoce los tipos escritos de varias formas", () => {
    assert.equal(tipoDe("Mano de obra"), "MO");
    assert.equal(tipoDe(" materiales "), "MT");
    assert.equal(tipoDe("Herramientas"), "EQ");
    assert.equal(tipoDe("SC"), "SC");
    assert.equal(tipoDe("otro"), null);
  });

  it("crea, actualiza por código o por descripción + unidad, y no reenvía lo que no cambió", () => {
    const plan = planificarImportacion(
      {
        insumos: [
          ["Plantilla", null],
          ["Código", "Descripción", "Unidad", "Precio", "Tipo", "IU", "OmniClass"],
          ["mo-001", "PEON", "HH", 18, "MO", "47", ""], // updated (code ignores case)
          ["", "CEMENTO", "BOL", 22.2, "MT", "", ""], // same as stored
          ["MT-9", "ARENA", "M3", "45,5", "material", "", ""], // new
          ["", "", "", 1, "MT"], // no description
          ["MT-9", "ARENA 2", "M3", 1, "MT"], // repeated code
          ["X", "RARO", "U", 1, "ZZ"], // bad kind
        ],
      },
      { insumos: [PEON, CEMENTO], partidas: [] }
    );
    assert.deepEqual(plan.resumen, { insumosNuevos: 1, insumosActualizados: 1, insumosSinCambios: 1, partidasNuevas: 0, partidasActualizadas: 0, partidasSinCambios: 0 });
    assert.deepEqual(plan.insumos.map((i) => [i.descripcion, i.precio, i.id === PEON.id]), [
      ["PEON", 18, true],
      ["ARENA", 45.5, false],
    ]);
    assert.equal(plan.errores.length, 3);
    assert.match(plan.errores.join("\n"), /fila 6: falta la descripción/);
    assert.match(plan.errores.join("\n"), /repite el insumo de la fila 5/);
  });

  it("arma el APU de cada partida con insumos y subpartidas, y rechaza ciclos", () => {
    const plan = planificarImportacion(
      {
        insumos: [["Código", "Descripción", "Unidad", "Precio", "Tipo"], ["MT-9", "ARENA", "M3", 45, "MT"]],
        partidas: [
          ["Código", "Descripción", "Unidad", "Rendimiento", "Jornada (h)", "OmniClass"],
          ["P1", "CONCRETO", "M3", 20, 8, "22-03 30 00"],
          ["P2", "COLUMNA", "M3", 10, null, ""],
          ["P3", "A", "U", 1, 8, ""],
          ["P4", "B", "U", 1, 8, ""],
        ],
        apu: [
          ["Código partida", "Tipo", "Código insumo o subpartida", "Descripción", "Unidad", "Cuadrilla", "Cantidad"],
          ["P1", "INSUMO", "MO-001", "", "", 2, null],
          ["P1", "INSUMO", "", "CEMENTO", "BOL", null, 9],
          ["P1", "INSUMO", "MT-9", "", "", null, 0.5],
          ["P2", "SUBPARTIDA", "P1", "", "", null, 1],
          ["P2", "INSUMO", "NADA", "", "", null, 1],
          ["P3", "SUBPARTIDA", "P4", "", "", null, 1],
          ["P4", "SUBPARTIDA", "P3", "", "", null, 1],
          ["P9", "INSUMO", "MO-001", "", "", 1, null],
        ],
      },
      { insumos: [PEON, CEMENTO], partidas: [] }
    );
    const p1 = plan.partidas.find((p) => p.codigo === "P1")!;
    const arena = plan.insumos[0];
    assert.deepEqual(p1.componentes, [
      { tipo: "insumo", id: PEON.id, cuadrilla: 2, cantidad: 0 },
      { tipo: "insumo", id: CEMENTO.id, cuadrilla: null, cantidad: 9 },
      { tipo: "insumo", id: arena.id, cuadrilla: null, cantidad: 0.5 },
    ]);
    const p2 = plan.partidas.find((p) => p.codigo === "P2")!;
    assert.equal(p2.jornada, 8);
    assert.deepEqual(p2.componentes, [{ tipo: "subpartida", id: p1.id, cuadrilla: null, cantidad: 1 }]);
    assert.ok(!plan.partidas.some((p) => p.codigo === "P3" || p.codigo === "P4"));
    const errores = plan.errores.join("\n");
    assert.match(errores, /no se encontró el insumo "NADA"/);
    assert.match(errores, /no hay una partida con el código "P9"/);
    assert.match(errores, /la contienen a ella misma/);
  });
});

describe("partidas del catálogo en el presupuesto", () => {
  const concreto: PartidaCatalogo = {
    id: "c-concreto",
    codigo: "P1",
    descripcion: "CONCRETO",
    unidad: "M3",
    omniclass: "22-03 30 00",
    rendimiento: 20,
    jornada: 8,
    componentes: [
      { tipo: "insumo", id: PEON.id, cuadrilla: 2, cantidad: 0 },
      { tipo: "insumo", id: CEMENTO.id, cuadrilla: null, cantidad: 9 },
    ],
    updatedAt: null,
    updatedBy: null,
  };
  const columna: PartidaCatalogo = { ...concreto, id: "c-columna", codigo: "P2", descripcion: "COLUMNA", componentes: [{ tipo: "subpartida", id: concreto.id, cuadrilla: null, cantidad: 1.05 }] };
  const catalogo = { insumos: new Map([PEON, CEMENTO].map((i) => [i.id, i])), partidas: new Map([concreto, columna].map((p) => [p.id, p])) };

  it("copia la partida con sus insumos y subpartidas, con el mismo costo", () => {
    const doc = documentoVacio();
    doc.insumos[CEMENTO.id] = { ...CEMENTO, precio: 25 }; // the budget already prices it
    const r = partidaDesdeCatalogo(columna, catalogo, doc);
    assert.equal(r.item.origenId, columna.id);
    const [sub] = Object.entries(r.subpartidas);
    assert.equal(sub[1].origenId, concreto.id);
    assert.deepEqual(r.item.componentes, [{ tipo: "subpartida", id: sub[0], cuadrilla: null, cantidad: 1.05 }]);
    assert.equal(r.insumos[CEMENTO.id].precio, 25); // kept
    assert.equal(r.insumos[PEON.id].precio, 16.5);
    const enCatalogo = calcularApu({ ...concreto, componentes: concreto.componentes }, resolverCatalogo(catalogo.insumos, catalogo.partidas));
    assert.equal(enCatalogo.cu, 213.0); // 0.8 × 16.5 + 9 × 22.2
    // A second copy reuses the subpartida.
    const again = importarApu(columna, catalogo, { insumos: r.insumos, subpartidas: r.subpartidas });
    assert.equal(Object.keys(again.subpartidas).length, 1);
  });

  it("al guardar quita precios y subpartidas que nada usa", () => {
    const doc = documentoVacio();
    const r = partidaDesdeCatalogo(columna, catalogo, doc);
    const conPartida = { ...doc, insumos: r.insumos, subpartidas: r.subpartidas };
    conPartida.subpresupuestos[0].items = [{ ...r.item }];
    const limpio = limpiarDocumento(conPartida);
    assert.equal(Object.keys(limpio.subpartidas).length, 1);
    assert.equal(Object.keys(limpio.insumos).length, 2);
    conPartida.subpresupuestos[0].items = [];
    const vacio = limpiarDocumento(conPartida);
    assert.deepEqual([Object.keys(vacio.subpartidas).length, Object.keys(vacio.insumos).length], [0, 0]);
    assert.ok(resolverPresupuesto(limpio).subpartida(Object.keys(limpio.subpartidas)[0]));
  });
});

describe("diccionario EDT en la plantilla", () => {
  const catalogo = { insumos: [PEON], partidas: [] as PartidaCatalogo[] };
  const cab = ["Código", "Descripción", "Unidad", "Rendimiento", "Jornada (h)", "OmniClass", "Descripción del trabajo", "Criterios de aceptación", "Responsable"];

  it("lee la descripción del trabajo, los criterios y el responsable de cada partida", () => {
    const plan = planificarImportacion({ partidas: [cab, ["P1", "ZAPATAS", "M3", 10, 8, "", "Zapatas de concreto", "f'c 210", "Ing. Pérez"], ["P2", "SOLADO", "M2", 10, 8, "", "", "", ""]] }, catalogo);
    assert.deepEqual(plan.partidas.find((p) => p.codigo === "P1")!.edt, { descripcion: "Zapatas de concreto", criterios: "f'c 210", responsable: "Ing. Pérez" });
    assert.equal(plan.partidas.find((p) => p.codigo === "P2")!.edt, undefined);
  });

  it("si la hoja no trae esas columnas conserva la EDT guardada; si las trae, en blanco la borra", () => {
    const guardada: PartidaCatalogo = { id: "c1", codigo: "P1", descripcion: "ZAPATAS", unidad: "M3", omniclass: "", rendimiento: 10, jornada: 8, componentes: [], edt: { descripcion: "D", criterios: "C", responsable: "R" }, updatedAt: null, updatedBy: null };
    const sin = planificarImportacion({ partidas: [["Código", "Descripción", "Unidad", "Rendimiento", "Jornada (h)"], ["P1", "ZAPATAS", "M3", 10, 8]] }, { insumos: [], partidas: [guardada] });
    assert.equal(sin.resumen.partidasSinCambios, 1);
    const con = planificarImportacion({ partidas: [cab, ["P1", "ZAPATAS", "M3", 10, 8, "", "", "", ""]] }, { insumos: [], partidas: [guardada] });
    assert.equal(con.resumen.partidasActualizadas, 1);
    assert.equal(con.partidas[0].edt, undefined);
  });
});
