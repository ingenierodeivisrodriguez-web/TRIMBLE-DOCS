import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { calcularSubpresupuesto, SubpresupuestoCalculado } from "./calc";
import {
  corteAnterior,
  curvaValorGanado,
  estadoAvance,
  estadoElementos,
  filasControl,
  indicadores,
  lecturaIndicadores,
  lineaBaseDe,
  Medidor,
  nuevoCorte,
  pctDelModelo,
} from "./avance";
import { documentoVacio, resolverPresupuesto } from "./doc";
import { programacionVacia, programar } from "./programacion";
import { Ctx, guardarDocumento } from "./service";
import { crearLineaBase, getAvance, getLineaBase, guardarAvance, marcarEjecutados, resumenEjecucion, usarLineaBase } from "./servicioAvance";
import { memoryStore, PresupuestoStore } from "./store";
import type { CorteAvance, ItemPartida, PresupuestoDoc, Programacion } from "./types";

const LV = { horasSemana: [8, 8, 8, 8, 8, 0, 0], jornada: 8, especiales: [] };

const partida = (id: string, metrado: number): ItemPartida => ({
  id,
  tipo: "partida",
  nivel: 1,
  codigo: "",
  descripcion: id.toUpperCase(),
  unidad: "M2",
  omniclass: "",
  rendimiento: 1,
  jornada: 8,
  componentes: [{ tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 1 }],
  metrado,
  origenId: null,
});

/** A (5 days, 1.000) and then B (5 days, 3.000), from Monday 05-10-2026, Monday to Friday. */
function plan() {
  const doc: PresupuestoDoc = documentoVacio();
  doc.insumos = { cem: { codigo: "", descripcion: "CEMENTO", unidad: "BOL", precio: 1000, tipo: "MT", iu: "", omniclass: "" } };
  doc.subpresupuestos[0].items = [{ id: "t1", tipo: "titulo", nivel: 0, descripcion: "OBRA" }, partida("a", 1), partida("b", 3)];
  const r = resolverPresupuesto(doc);
  const calculados = new Map<string, SubpresupuestoCalculado>(doc.subpresupuestos.map((sp) => [sp.id, calcularSubpresupuesto(sp, r, () => null)]));
  const prog: Programacion = { ...programacionVacia("2026-10-05"), calendario: LV, tareas: { a: { duracion: 5 }, b: { duracion: 5, predecesoras: [{ id: "a", tipo: "FC", desfase: 0 }] } } };
  const res = programar(doc, calculados, prog);
  return { doc, base: lineaBaseDe(res, prog), spId: doc.subpresupuestos[0].id };
}

const corte = (fecha: string, partidas: CorteAvance["partidas"]): CorteAvance => ({ id: `c-${fecha}`, fecha, nota: "", partidas });

describe("línea base", () => {
  it("congela las fechas, las horas y el costo de cada fila", () => {
    const { base, spId } = plan();
    assert.deepEqual([base.inicio, base.fin, base.total, base.calendarioInicio], ["2026-10-05", "2026-10-16", 4000, "2026-10-05"]);
    assert.deepEqual(
      base.tareas.map((t) => [t.id, t.tipo, t.costo, t.es, t.ef, t.inicio, t.fin]),
      [
        [`sp:${spId}`, "sp", 4000, 0, 80, "2026-10-05", "2026-10-16"],
        ["t1", "titulo", 4000, 0, 80, "2026-10-05", "2026-10-16"],
        ["a", "partida", 1000, 0, 40, "2026-10-05", "2026-10-09"],
        ["b", "partida", 3000, 40, 80, "2026-10-12", "2026-10-16"],
      ]
    );
  });
});

describe("valor ganado", () => {
  it("atrasada y gastando de más: PV, EV, AC e indicadores al corte", () => {
    const m = new Medidor(plan().base);
    // Wednesday 07-10: 3 of A's 5 days planned (600); 40 % of A done (400), and it cost 500.
    const i = indicadores(m, corte("2026-10-07", { a: { pct: 40, costo: 500 } }));
    assert.deepEqual(
      { bac: i.bac, pv: i.pv, ev: i.ev, ac: i.ac, sv: i.sv, spi: i.spi, cv: i.cv, cpi: i.cpi, eac: i.eac, vac: i.vac, pctPlaneado: i.pctPlaneado, pctReal: i.pctReal },
      { bac: 4000, pv: 600, ev: 400, ac: 500, sv: -200, spi: 0.667, cv: -100, cpi: 0.8, eac: 5000, vac: -1000, pctPlaneado: 15, pctReal: 10 }
    );
    // What was done had been planned for Tuesday at noon: a day behind; at this pace it ends 23-10.
    assert.deepEqual([i.svDias, i.spiT, i.finEstimado, i.terminada], [-1, 0.667, "2026-10-23", false]);
    assert.deepEqual(lecturaIndicadores(i), [
      "En plazo, la obra va atrasada: lo ejecutado se había previsto 1 día(s) hábil(es) antes (SPI 0,667).",
      "En costo, se está gastando más de lo previsto por lo ejecutado (CPI 0,8).",
    ]);
  });

  it("adelantada, sin costo registrado, y lo que aún no debía empezar no cuenta como atraso", () => {
    const m = new Medidor(plan().base);
    const adelantada = indicadores(m, corte("2026-10-07", { a: { pct: 100 } }));
    assert.deepEqual([adelantada.ev, adelantada.svDias, adelantada.ac, adelantada.cpi], [1000, 2, null, null]);
    assert.match(lecturaIndicadores(adelantada)[1], /registra el costo real/);
    const b = indicadores(m, corte("2026-10-07", { a: { pct: 40 } }), "b");
    assert.deepEqual([b.pv, b.ev, b.svDias, b.spiT, b.finEstimado], [0, 0, 0, null, null]);
    const todo = indicadores(m, corte("2026-10-20", { a: { pct: 100 }, b: { pct: 100 } }));
    assert.deepEqual([todo.terminada, todo.finEstimado, todo.svDias], [true, "2026-10-20", null]);
  });

  it("cada fila con su estado; los títulos suman sus partidas", () => {
    const { base, spId } = plan();
    const f = filasControl(new Medidor(base), corte("2026-10-07", { a: { pct: 40, costo: 500 } }));
    assert.deepEqual(
      f.map((x) => [x.tarea.id, x.bac, x.pv, x.ev, x.ac, x.pctPlaneado, x.pctReal, x.estado]),
      [
        [`sp:${spId}`, 4000, 600, 400, 500, 15, 10, "atrasada"],
        ["t1", 4000, 600, 400, 500, 15, 10, "atrasada"],
        ["a", 1000, 600, 400, 500, 60, 40, "atrasada"],
        ["b", 3000, 0, 0, null, 0, 0, "sin-iniciar"],
      ]
    );
    assert.deepEqual([estadoAvance(50, 50.3), estadoAvance(50, 60), estadoAvance(80, 100)], ["al-dia", "adelantada", "terminada"]);
  });

  it("la curva S planeada contra la real, por semanas", () => {
    const c = curvaValorGanado(new Medidor(plan().base), [corte("2026-10-07", { a: { pct: 40, costo: 500 } })], "semana");
    assert.deepEqual(
      c.puntos.map((p) => [p.periodo.desde, p.pv, p.ev, p.ac]),
      [
        ["2026-10-05", 1000, 400, 500],
        ["2026-10-12", 4000, null, null], // after the last cut
      ]
    );
    assert.equal(c.bac, 4000);
  });

  it("el avance según los elementos ejecutados en el visor, y un corte nuevo parte del anterior", () => {
    assert.equal(pctDelModelo({ itemId: "a", elementos: 3, ejecutados: 1, suma: 10, sumaEjecutada: 3 }), 30);
    assert.equal(pctDelModelo({ itemId: "a", elementos: 4, ejecutados: 1, suma: 0, sumaEjecutada: 0 }), 25); // not measured: by count
    assert.equal(pctDelModelo(undefined), null);
    const c1 = corte("2026-10-07", { a: { pct: 40, costo: 500 } });
    const c2 = nuevoCorte("c2", "2026-10-14", c1);
    c2.partidas.a.pct = 90;
    assert.equal(c1.partidas.a.pct, 40);
    assert.equal(corteAnterior([c1, c2], "2026-10-14"), c1);
    assert.equal(corteAnterior([c1, c2], "2026-10-07"), null);
  });
});

// ---------------------------------------------------------------- the service

const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
const lector: Caller = { id: "u3", name: "Marta", isAdmin: false, memberOfGroups: async () => new Set() };

function ctx(store: PresupuestoStore, caller: Caller): Ctx {
  return { projectId: "obra1", caller, store, deps: { callerIn: async () => caller, projectName: async () => "" } };
}

const status = (n: number) => (e: unknown) => e instanceof ServiceError && e.status === n;

describe("servicio de avance", () => {
  it("guarda líneas base (una vigente) y cortes con su versión", async () => {
    const store = memoryStore();
    const { base } = plan();
    await assert.rejects(crearLineaBase(ctx(store, lector), { nombre: "LB", datos: base }), status(403));
    await assert.rejects(crearLineaBase(ctx(store, admin), { nombre: " ", datos: base }), /nombre/);
    await assert.rejects(crearLineaBase(ctx(store, admin), { nombre: "LB", datos: { ...base, tareas: base.tareas.filter((t) => t.tipo !== "partida") } }), /no tiene partidas/);
    const lb1 = (await crearLineaBase(ctx(store, admin), { nombre: "Línea base 1", datos: base })).lineaBase;
    assert.deepEqual([lb1.nombre, lb1.vigente, lb1.total, lb1.partidas, lb1.creadaPor], ["Línea base 1", true, 4000, 2, "Ana"]);
    const lb2 = (await crearLineaBase(ctx(store, admin), { nombre: "Reprogramación", datos: { ...base, fin: "2026-10-30" } })).lineaBase;
    let a = await getAvance(ctx(store, lector)); // members read
    assert.deepEqual(
      a.lineasBase.map((l) => [l.nombre, l.vigente]),
      [
        ["Reprogramación", true],
        ["Línea base 1", false],
      ]
    );
    assert.equal(a.lineaBase?.id, lb2.id);
    assert.equal(a.lineaBase?.datos.tareas.length, 4);
    assert.deepEqual([a.avance, a.version], [null, 0]);
    await usarLineaBase(ctx(store, admin), { id: lb1.id });
    assert.equal((await getAvance(ctx(store, admin))).lineaBase?.id, lb1.id);
    await assert.rejects(usarLineaBase(ctx(store, admin), { id: "00000000-0000-4000-8000-000000000000" }), status(404));
    assert.equal((await getLineaBase(ctx(store, admin), lb2.id)).lineaBase.fin, "2026-10-30");

    // Progress reports: one per date, % up to 100, sorted, with the version.
    const c1 = corte("2026-10-14", { a: { pct: 100, costo: 1100 }, b: { pct: 0 } });
    const c0 = corte("2026-10-07", { a: { pct: 40.123 } });
    await assert.rejects(guardarAvance(ctx(store, lector), { avance: { cortes: [c1] }, version: 0 }), status(403));
    await assert.rejects(guardarAvance(ctx(store, admin), { avance: { cortes: [corte("2026-10-07", { a: { pct: 120 } })] }, version: 0 }), /100 %/);
    await assert.rejects(guardarAvance(ctx(store, admin), { avance: { cortes: [c0, { ...c1, fecha: "2026-10-07" }] }, version: 0 }), /dos cortes con la fecha 07-10-2026/);
    const v = await guardarAvance(ctx(store, admin), { avance: { cortes: [c1, c0] }, version: 0 });
    assert.equal(v.version, 1);
    await assert.rejects(guardarAvance(ctx(store, admin), { avance: { cortes: [] }, version: 0 }), status(409));
    a = await getAvance(ctx(store, admin));
    assert.deepEqual(
      a.avance!.cortes.map((c) => [c.fecha, c.partidas]),
      [
        ["2026-10-07", { a: { pct: 40.12 } }],
        ["2026-10-14", { a: { pct: 100, costo: 1100 } }], // 0 % without cost is not stored
      ]
    );
    assert.equal(a.updatedBy, "Ana");
  });

  it("marca en el visor los elementos ejecutados, por partida y fecha", async () => {
    const store = memoryStore();
    await guardarDocumento(ctx(store, admin), { doc: documentoVacio(), version: 0 });
    const g1 = "2CqVfw$t15ihB2vPgB1wri";
    const g2 = "2CqVfw$t15ihB2vPgB1wrj";
    await store.saveElementos(
      "obra1",
      "a",
      [
        { ifcGuid: g1, modelId: "m", cantidad: 3, memoria: null },
        { ifcGuid: g2, modelId: "m", cantidad: 1, memoria: null },
      ],
      [],
      "Ana"
    );
    await assert.rejects(marcarEjecutados(ctx(store, lector), { marcas: [{ itemId: "a", ifcGuid: g1 }], fecha: "2026-10-05" }), status(403));
    await assert.rejects(marcarEjecutados(ctx(store, admin), { marcas: [{ itemId: "a", ifcGuid: g1 }], fecha: "2999-01-01" }), /posterior a hoy/);
    await assert.rejects(marcarEjecutados(ctx(store, admin), { marcas: [{ itemId: "a", ifcGuid: "malo" }], fecha: "2026-10-05" }), /IFCGUID/);
    assert.deepEqual(await marcarEjecutados(ctx(store, admin), { marcas: [{ itemId: "a", ifcGuid: g1 }, { itemId: "a", ifcGuid: g1 }, { itemId: "zz", ifcGuid: g2 }], fecha: "2026-10-05" }), { marcados: 1 });
    assert.deepEqual((await resumenEjecucion(ctx(store, admin), "2026-10-04")).items, [{ itemId: "a", elementos: 2, ejecutados: 0, suma: 4, sumaEjecutada: 0 }]);
    assert.deepEqual((await resumenEjecucion(ctx(store, admin), "2026-10-05")).items, [{ itemId: "a", elementos: 2, ejecutados: 1, suma: 4, sumaEjecutada: 3 }]);
    // Updating the element (its memoria, its quantity) keeps the day it was built.
    await store.saveElementos("obra1", "a", [{ ifcGuid: g1, modelId: "m", cantidad: 3.5, memoria: { zona: "Z1" } }], [], "Ana");
    assert.equal((await store.getElementos("obra1", { ifcGuids: [g1] }))[0].ejecutado, "2026-10-05");
    // Unmarking.
    await marcarEjecutados(ctx(store, admin), { marcas: [{ itemId: "a", ifcGuid: g1 }], fecha: null });
    assert.equal((await store.getElementos("obra1", { ifcGuids: [g1] }))[0].ejecutado, null);
    await assert.rejects(resumenEjecucion(ctx(store, admin), "05-10-2026"), status(400));
  });
});

describe("el modelo coloreado por avance", () => {
  it("ejecutado, atrasado, en curso o pendiente según la línea base; el peor de sus partidas", () => {
    const { base } = plan(); // A: 05-10 to 09-10, B: 12-10 to 16-10
    const e = (itemId: string, ifcGuid: string, ejecutado: string | null = null) => ({ itemId, ifcGuid, modelId: "m", ejecutado });
    const r = estadoElementos([e("a", "g1", "2026-10-08"), e("a", "g2"), e("b", "g3"), e("a", "g4", "2026-10-08"), e("b", "g4"), e("zz", "g5"), e("a", "g6", "2026-10-20")], "2026-10-12", base);
    assert.deepEqual(
      [...r].map(([g, x]) => [g, x.estado]),
      [
        ["g1", "ejecutado"],
        ["g2", "atrasado"], // A had to finish by 09-10
        ["g3", "en-curso"], // B started 12-10
        ["g4", "en-curso"], // built for A, but B is still pending
        ["g5", "pendiente"], // not in the baseline
        ["g6", "atrasado"], // built after the date
      ]
    );
    assert.equal(estadoElementos([e("b", "g3")], "2026-10-09", base).get("g3")?.estado, "pendiente");
    assert.equal(estadoElementos([e("b", "g3")], "2026-10-09", null).get("g3")?.estado, "pendiente");
  });
});
