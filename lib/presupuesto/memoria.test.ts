import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDataset } from "../graficos/modelData";
import { Caller } from "../propiedades/service";
import { documentoVacio } from "./doc";
import { memoriaDe, memoriaLimpia, porUbicacion } from "./memoria";
import { consultarElementos, Ctx, getDocumento, guardarDocumento, guardarElementos } from "./service";
import { memoryStore } from "./store";
import type { Memoria } from "./types";

const ventana = (id: number, props: Record<string, string | number>) => ({
  id,
  class: "IfcWindow",
  properties: [{ name: "Ubicación", properties: Object.entries(props).map(([name, value]) => ({ name, value, type: typeof value === "number" ? 7 : 5 })) }],
});

describe("memoria de cantidades", () => {
  const ds = buildDataset("m", "Arq", [
    ventana(1, { Bloque: "Etapa 1", Conjunto: "Torre 1", Zona: "Residencial", "Nombre de Zona": "xx01", Espacio: "Alcoba", Otro: "x" }),
    ventana(2, { bloque: "Etapa 1", Espacio: 12 }),
    ventana(3, { Otro: "x" }),
  ]);

  it("lee bloque, conjunto, zona, nombre de zona y espacio de las propiedades del modelo", () => {
    assert.deepEqual(memoriaDe(ds, ds.records[0]), { bloque: "Etapa 1", conjunto: "Torre 1", zona: "Residencial", nombreZona: "xx01", espacio: "Alcoba" });
    assert.deepEqual(memoriaDe(ds, ds.records[1]), { bloque: "Etapa 1", conjunto: "", zona: "", nombreZona: "", espacio: "12" });
    assert.equal(memoriaDe(ds, ds.records[2]), null);
  });

  it("ordena por ubicación con los números en su orden natural", () => {
    const m = (espacio: string): { memoria: Memoria } => ({ memoria: { bloque: "B", conjunto: "", zona: "", nombreZona: "", espacio } });
    assert.deepEqual(porUbicacion([m("10"), m("2"), m("1")]).map((e) => e.memoria.espacio), ["1", "2", "10"]);
    assert.deepEqual(memoriaLimpia({ bloque: " A ", extra: 1 }), { bloque: "A", conjunto: "", zona: "", nombreZona: "", espacio: "" });
    assert.equal(memoriaLimpia({}), null);
  });
});

describe("modo del metrado y diccionario EDT", () => {
  const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
  const G1 = "3CqVfw$t15ihB2vPgB1wri";
  const ctx = (store = memoryStore()): Ctx => ({ projectId: "obra1", caller: admin, store, deps: { callerIn: async () => admin, projectName: async () => "" } });

  it("guarda el modo, la EDT y la memoria de los elementos", async () => {
    const c = ctx();
    const doc = documentoVacio();
    doc.subpresupuestos[0].items = [
      { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "ZAPATAS", unidad: "UN", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 3, origenId: null, modo: "manual", edt: { descripcion: "Zapatas de concreto", criterios: "f'c 210", responsable: "Ing. Pérez" } },
    ];
    await guardarDocumento(c, { doc, version: 0 });
    const guardado = (await getDocumento(c)).doc.subpresupuestos[0].items[0] as { modo?: string; edt?: { responsable: string } };
    assert.equal(guardado.modo, "manual");
    assert.equal(guardado.edt?.responsable, "Ing. Pérez");

    const memoria = { bloque: "Etapa 1", conjunto: "Torre 1", zona: "Residencial", nombreZona: "xx01", espacio: "Alcoba" };
    await guardarElementos(c, { itemId: "p1", upsert: [{ ifcGuid: G1, modelId: "m", cantidad: 1, memoria }] });
    assert.deepEqual((await consultarElementos(c, { itemIds: ["p1"] })).elementos[0].memoria, memoria);
  });

  it("descarta un modo desconocido y una EDT vacía", async () => {
    const c = ctx();
    const doc = documentoVacio();
    doc.subpresupuestos[0].items = [
      { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "X", unidad: "", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 0, origenId: null, modo: "raro" as never, edt: { descripcion: "", criterios: "", responsable: "" } },
    ];
    await guardarDocumento(c, { doc, version: 0 });
    const it = (await getDocumento(c)).doc.subpresupuestos[0].items[0] as { modo?: string; edt?: unknown };
    assert.equal(it.modo, undefined);
    assert.equal(it.edt, undefined);
  });
});
