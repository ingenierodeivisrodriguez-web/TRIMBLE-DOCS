import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { documentoVacio } from "./doc";
import { Ctx, getAtributos, guardarCamposModelo, guardarDocumento, pedirVista, tomarVista, updateConfig } from "./service";
import { memoryStore } from "./store";
import { leerCamposModelos, Visor } from "./viewerMap";

const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
const lector: Caller = { id: "u3", name: "Marta", isAdmin: false, memberOfGroups: async () => new Set() };

function ctx(store = memoryStore(), caller: Caller = admin): Ctx {
  return { projectId: "obra1", caller, store, deps: { callerIn: async () => caller, projectName: async () => "" } };
}

/** A viewer with models of `n` objects: every 10th is a window with the location properties. */
function visorFalso(modelos: { id: string; name: string; n: number }[]) {
  const lecturas: number[] = [];
  const visor = {
    getModels: async () => modelos.map((m) => ({ id: m.id, name: m.name, versionId: m.id + "v" })),
    getObjects: async (sel?: { modelObjectIds?: { modelId: string }[] }) => {
      const pedido = sel?.modelObjectIds?.[0]?.modelId;
      return modelos.filter((m) => !pedido || m.id === pedido).map((m) => ({ modelId: m.id, objects: Array.from({ length: m.n }, (_, i) => ({ id: i + 1 })) }));
    },
    getObjectProperties: async (_model: string, ids: number[]) => {
      lecturas.push(ids.length);
      return ids.map((id) => ({
        id,
        class: id % 10 === 0 ? "IfcWindow" : "IfcWall",
        product: { name: "Objeto " + id },
        properties: [
          { name: "Ubicación", properties: id % 10 === 0 ? [{ name: "Bloque", value: "Etapa 1", type: 5 }, { name: "Nivel", value: "Piso 2", type: 5 }] : [{ name: "Nivel", value: "Piso 1", type: 5 }] },
          ...(id === 1 ? [{ name: "Raro", properties: [{ name: "Solo el primero", value: 3, type: 7 }] }] : []),
        ],
      }));
    },
  } as unknown as Visor;
  return { visor, lecturas };
}

describe("propiedades de los modelos cargados", () => {
  it("lee una muestra repartida de cada modelo y cuenta cuántos elementos tienen cada propiedad", async () => {
    const { visor, lecturas } = visorFalso([{ id: "a", name: "ARQ.ifc", n: 5000 }]);
    const r = (await leerCamposModelos(visor, { completo: false }))!;
    assert.deepEqual(r.modelos, ["ARQ.ifc"]);
    assert.equal(lecturas.reduce((x, y) => x + y, 0), 2000); // a sample, not 5000
    const por = new Map(r.campos.map((c) => [c.key, c]));
    assert.ok(por.has("Ubicación · Bloque") && por.has("Ubicación · Nivel") && por.has("@name") && por.has("@class"));
    assert.ok(por.get("Ubicación · Nivel")!.count > por.get("Ubicación · Bloque")!.count); // ordered by how common
    assert.equal(r.campos[0].count >= r.campos[r.campos.length - 1].count, true);
  });

  it("en modo completo lee todos los elementos, de todos los modelos", async () => {
    const { visor, lecturas } = visorFalso([
      { id: "a", name: "ARQ.ifc", n: 300 },
      { id: "b", name: "EST.ifc", n: 100 },
    ]);
    const r = (await leerCamposModelos(visor, { completo: true }))!;
    assert.deepEqual(r.modelos, ["ARQ.ifc", "EST.ifc"]);
    assert.ok(lecturas.reduce((x, y) => x + y, 0) >= 400);
    assert.equal(r.campos.find((c) => c.key === "Ubicación · Bloque")!.count, 40); // 30 + 10 windows
  });

  it("se puede cancelar, y avisa si no hay modelos", async () => {
    const { visor } = visorFalso([{ id: "a", name: "ARQ.ifc", n: 1000 }]);
    assert.equal(await leerCamposModelos(visor, { completo: true, cancelado: () => true }), null);
    const vacio = { getModels: async () => [] } as unknown as Visor;
    await assert.rejects(leerCamposModelos(vacio, { completo: false }), /No hay modelos cargados/);
  });
});

describe("guardar y consultar las propiedades leídas", () => {
  const campos = [
    { key: "Ubicación · Nivel", label: "Nivel", group: "Ubicación", kind: "text", count: 120 },
    { key: "@name", label: "Nombre", group: "General", kind: "text", count: 200 },
    { key: "Ubicación · Nivel", label: "Repetida", group: "Ubicación", kind: "text", count: 1 },
  ];

  it("la guardan administradores y editores, y la ve todo el equipo", async () => {
    const store = memoryStore();
    assert.equal((await getAtributos(ctx(store))).modelo, null);
    await guardarDocumento(ctx(store), { doc: documentoVacio(), version: 0 });
    await assert.rejects(guardarCamposModelo(ctx(store, lector), { modelos: ["ARQ.ifc"], campos }), (e: unknown) => e instanceof ServiceError && e.status === 403);
    assert.deepEqual(await guardarCamposModelo(ctx(store), { modelos: ["ARQ.ifc"], campos }), { guardadas: 2 }); // the repeated key is dropped
    const modelo = (await getAtributos(ctx(store, lector))).modelo!;
    assert.deepEqual(modelo.campos.map((c) => c.key), ["Ubicación · Nivel", "@name"]);
    assert.deepEqual(modelo.modelos, ["ARQ.ifc"]);
    assert.equal(modelo.leidoPor, "Ana");
  });

  it("rechaza una lista vacía o con formato inválido", async () => {
    const invalid = (e: unknown) => e instanceof ServiceError && e.status === 400;
    await assert.rejects(guardarCamposModelo(ctx(), { modelos: [], campos: [] }), invalid);
    await assert.rejects(guardarCamposModelo(ctx(), { modelos: [], campos: "no" }), invalid);
    await assert.rejects(guardarCamposModelo(ctx(), { modelos: [], campos: [{ key: "", label: "x" }] }), invalid);
  });

  it("una columna elegida de la lista (con su clave exacta) se guarda en la configuración", async () => {
    const store = memoryStore();
    const estado = await updateConfig(ctx(store), { memoriaColumnas: [{ id: "n", label: "Nivel", fuente: "modelo", clave: "Ubicación · Nivel" }] });
    assert.equal(estado.config.memoriaColumnas[0].clave, "Ubicación · Nivel");
  });
});

describe("ver en 3D: traspaso del menú al visor", () => {
  const G1 = "3CqVfw$t15ihB2vPgB1wri";
  const G2 = "0000000000000000000000";
  const invalid = (e: unknown) => e instanceof ServiceError && e.status === 400;

  it("deja los elementos pedidos para el panel del visor de esa persona, una sola vez", async () => {
    const store = memoryStore();
    const yo = ctx(store);
    const otro = ctx(store, lector);
    assert.deepEqual(await pedirVista(yo, { itemId: "p1", elementos: [{ ifcGuid: G1, modelId: "m" }, { ifcGuid: G2, modelId: "m" }] }), { elementos: 2 });
    assert.deepEqual((await tomarVista(otro)).vista, null); // each person has their own
    const vista = (await tomarVista(yo)).vista!;
    assert.equal(vista.itemId, "p1");
    assert.deepEqual(vista.elementos.map((e) => e.ifcGuid), [G1, G2]);
    assert.equal((await tomarVista(yo)).vista, null); // taken
  });

  it("la última petición reemplaza a la anterior y las viejas se descartan", async () => {
    const store = memoryStore();
    const yo = ctx(store);
    await pedirVista(yo, { itemId: "p1", elementos: [{ ifcGuid: G1, modelId: "m" }] });
    await pedirVista(yo, { itemId: "p2", elementos: [{ ifcGuid: G2, modelId: "m" }] });
    assert.equal((await tomarVista(yo)).vista?.itemId, "p2");
    await store.saveVista("obra1", "u1", { itemId: "p3", elementos: [{ ifcGuid: G1, modelId: "m" }] });
    assert.equal(await store.takeVista("obra1", "u1", -1), null); // older than the limit
  });

  it("rechaza peticiones mal formadas", async () => {
    const yo = ctx();
    await assert.rejects(pedirVista(yo, { itemId: "p1", elementos: [] }), invalid);
    await assert.rejects(pedirVista(yo, { itemId: "no valido!", elementos: [{ ifcGuid: G1, modelId: "m" }] }), invalid);
    await assert.rejects(pedirVista(yo, { itemId: "p1", elementos: [{ ifcGuid: "nope", modelId: "m" }] }), invalid);
    await assert.rejects(pedirVista(yo, { itemId: "p1", elementos: [{ ifcGuid: G1, modelId: "" }] }), invalid);
  });
});
