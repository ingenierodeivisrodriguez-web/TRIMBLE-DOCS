import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { documentoVacio } from "./doc";
import {
  consultarElementos,
  Ctx,
  eliminarInsumo,
  getCatalogo,
  getDocumento,
  getEstado,
  getResumen,
  guardarDocumento,
  guardarElementos,
  guardarInsumos,
  guardarMedicion,
  guardarPartidas,
  updateConfig,
} from "./service";
import { memoryStore, PresupuestoStore } from "./store";
import type { PresupuestoDoc } from "./types";

const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
const editorPorGrupo: Caller = { id: "u2", name: "Luis", isAdmin: false, memberOfGroups: async (ids) => new Set(ids.filter((i) => i === "g-costos")) };
const lector: Caller = { id: "u3", name: "Marta", isAdmin: false, memberOfGroups: async () => new Set() };

const OBRA = "obra1";
const BASE = "baseEmpresa";
const G1 = "3CqVfw$t15ihB2vPgB1wri";
const G2 = "0000000000000000000000";
const UUID1 = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const PARTIDA = "33333333-3333-4333-8333-333333333333";

/** Who the caller is in each project (absent: not a member). */
function ctx(store: PresupuestoStore, caller: Caller, projectId = OBRA, membership: Record<string, Caller> = {}): Ctx {
  return {
    projectId,
    caller,
    store,
    deps: {
      callerIn: async (id) => {
        if (id === projectId) return caller;
        const c = membership[id];
        if (!c) throw new Error("not a member");
        return c;
      },
      projectName: async (id) => `Proyecto ${id}`,
    },
  };
}

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

const insumo = (id: string, codigo: string, descripcion: string) => ({ id, codigo, descripcion, unidad: "BOL", precio: 22.2, tipo: "MT", iu: "21", omniclass: "" });

function docConPartida(): PresupuestoDoc {
  const doc = documentoVacio();
  doc.insumos[UUID1] = { codigo: "C1", descripcion: "CEMENTO", unidad: "BOL", precio: 22.2, tipo: "MT", iu: "", omniclass: "" };
  doc.subpresupuestos[0].items = [
    { id: "t1", tipo: "titulo", nivel: 0, descripcion: "CONCRETO" },
    {
      id: "p1",
      tipo: "partida",
      nivel: 1,
      codigo: "",
      descripcion: "CONCRETO EN COLUMNAS",
      unidad: "M3",
      omniclass: "22-03 30 00",
      rendimiento: 20,
      jornada: 8,
      componentes: [{ tipo: "insumo", id: UUID1, cuadrilla: null, cantidad: 9 }],
      metrado: 0,
      origenId: null,
    },
  ];
  return doc;
}

describe("permisos del presupuesto", () => {
  it("administradores y editores (personas o grupos) editan; el resto solo consulta", async () => {
    const store = memoryStore();
    assert.equal((await getEstado(ctx(store, lector))).canEdit, false);
    await updateConfig(ctx(store, admin), { editores: [{ type: "group", id: "g-costos", name: "Costos" }] });
    assert.equal((await getEstado(ctx(store, editorPorGrupo))).canEdit, true);
    assert.equal((await getEstado(ctx(store, lector))).canEdit, false);
    await rejects(updateConfig(ctx(store, editorPorGrupo), { editores: [] }), 403, "not-admin");

    const { version } = await guardarDocumento(ctx(store, editorPorGrupo), { doc: docConPartida(), version: 0 });
    assert.equal(version, 1);
    await rejects(guardarDocumento(ctx(store, lector), { doc: docConPartida(), version: 1 }), 403, "not-editor");
    assert.equal((await getDocumento(ctx(store, lector))).doc.subpresupuestos[0].items.length, 2);
  });

  it("un guardado sobre una versión vieja no pisa el de otra persona", async () => {
    const store = memoryStore();
    await guardarDocumento(ctx(store, admin), { doc: docConPartida(), version: 0 });
    await guardarDocumento(ctx(store, admin), { doc: docConPartida(), version: 1 });
    await rejects(guardarDocumento(ctx(store, admin), { doc: docConPartida(), version: 1 }), 409, "version-conflict");
  });

  it("rechaza presupuestos mal formados", async () => {
    const store = memoryStore();
    const roto = docConPartida();
    roto.subpresupuestos[0].items[1].nivel = 3;
    await rejects(guardarDocumento(ctx(store, admin), { doc: roto, version: 0 }), 400);
    const sinPrecio = docConPartida();
    sinPrecio.insumos = {};
    await rejects(guardarDocumento(ctx(store, admin), { doc: sinPrecio, version: 0 }), 400);
  });
});

describe("catálogo en un proyecto base", () => {
  it("la obra usa el catálogo de la base; solo sus administradores o editores lo modifican", async () => {
    const store = memoryStore();
    // The base project's own catalog, edited by its administrator.
    await guardarInsumos(ctx(store, admin, BASE), { insumos: [insumo(UUID1, "C1", "CEMENTO")] });

    // Linking requires being a member of the base.
    await rejects(updateConfig(ctx(store, admin), { baseProjectId: BASE }), 403, "not-base-member");
    // A mere member of the base can't share its prices with another project.
    const lectorEnBase = { ...lector };
    await rejects(updateConfig(ctx(store, admin, OBRA, { [BASE]: lectorEnBase }), { baseProjectId: BASE }), 403, "not-base-editor");
    const estado = await updateConfig(ctx(store, admin, OBRA, { [BASE]: admin }), { baseProjectId: BASE });
    assert.equal(estado.config.baseProjectName, `Proyecto ${BASE}`);
    assert.equal((await getEstado(ctx(store, admin, OBRA, { [BASE]: lectorEnBase }))).canEditBase, false); // admin of the obra, reader in the base

    const catalogo = await getCatalogo(ctx(store, lector));
    assert.deepEqual(catalogo.insumos.map((i) => i.descripcion), ["CEMENTO"]);
    await rejects(guardarInsumos(ctx(store, admin, OBRA, { [BASE]: lectorEnBase }), { insumos: [insumo(UUID2, "A1", "ARENA")] }), 403, "not-base-editor");

    // An administrator of the base can, from the obra.
    await guardarInsumos(ctx(store, lector, OBRA, { [BASE]: admin }), { insumos: [insumo(UUID2, "A1", "ARENA")] });
    assert.equal((await getCatalogo(ctx(store, lector))).insumos.length, 2);
  });

  it("no repite códigos ni borra insumos que usan las partidas", async () => {
    const store = memoryStore();
    await guardarInsumos(ctx(store, admin), { insumos: [insumo(UUID1, "C1", "CEMENTO")] });
    await rejects(guardarInsumos(ctx(store, admin), { insumos: [insumo(UUID2, "c1 ", "OTRO")] }), 409, "duplicate-code");
    await rejects(guardarInsumos(ctx(store, admin), { insumos: [insumo(UUID2, "X", "A"), insumo("44444444-4444-4444-8444-444444444444", "x", "B")] }), 400);
    await guardarPartidas(ctx(store, admin), {
      partidas: [
        {
          id: PARTIDA,
          codigo: "P1",
          descripcion: "CONCRETO",
          unidad: "M3",
          omniclass: "22-03 30 00",
          rendimiento: 20,
          jornada: 8,
          componentes: [{ tipo: "insumo", id: UUID1, cuadrilla: null, cantidad: 9 }],
        },
      ],
    });
    await rejects(eliminarInsumo(ctx(store, admin), UUID1), 409, "in-use");
    await rejects(
      guardarPartidas(ctx(store, admin), {
        partidas: [{ id: PARTIDA, codigo: "P1", descripcion: "X", unidad: "M3", omniclass: "", rendimiento: 1, jornada: 8, componentes: [{ tipo: "subpartida", id: PARTIDA, cuadrilla: null, cantidad: 1 }] }],
      }),
      400
    );
  });
});

describe("elementos del modelo", () => {
  it("se asocian a partidas guardadas y se limpian cuando la partida se borra", async () => {
    const store = memoryStore();
    await rejects(guardarElementos(ctx(store, admin), { itemId: "p1", upsert: [{ ifcGuid: G1, modelId: "m", cantidad: 2 }] }), 400);
    await guardarDocumento(ctx(store, admin), { doc: docConPartida(), version: 0 });
    await rejects(guardarElementos(ctx(store, lector), { itemId: "p1", upsert: [] }), 403);
    await rejects(guardarElementos(ctx(store, admin), { itemId: "t1", upsert: [] }), 400); // a title

    await guardarElementos(ctx(store, admin), {
      itemId: "p1",
      upsert: [
        { ifcGuid: G1, modelId: "m", cantidad: 2.5 },
        { ifcGuid: G2, modelId: "m", cantidad: 1.5 },
      ],
    });
    await guardarMedicion(ctx(store, admin), { itemId: "p1", campo: "Dimensions · Volume", campoLabel: "Volume (m³)", unidad: "m³" });
    let resumen = await getResumen(ctx(store, lector));
    assert.deepEqual(resumen.resumen, [{ itemId: "p1", elementos: 2, suma: 4 }]);
    assert.equal(resumen.mediciones[0].campo, "Dimensions · Volume");

    await guardarElementos(ctx(store, admin), { itemId: "p1", remove: [G2] });
    assert.deepEqual((await consultarElementos(ctx(store, lector), { ifcGuids: [G1, G2] })).elementos.map((e) => e.ifcGuid), [G1]);
    await rejects(guardarElementos(ctx(store, admin), { itemId: "p1", upsert: [{ ifcGuid: "no-es-guid", modelId: "m", cantidad: 1 }] }), 400);

    const sinPartida = docConPartida();
    sinPartida.subpresupuestos[0].items = sinPartida.subpresupuestos[0].items.slice(0, 1);
    sinPartida.insumos = {};
    await guardarDocumento(ctx(store, admin), { doc: sinPartida, version: 1 });
    resumen = await getResumen(ctx(store, lector));
    assert.deepEqual(resumen, { mediciones: [], resumen: [] });
  });
});
