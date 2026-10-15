import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceError } from "../propiedades/service";
import { calcularSubpresupuesto, SubpresupuestoCalculado } from "./calc";
import { documentoVacio, resolverPresupuesto } from "./doc";
import {
  cambiarPadre,
  completarAsignaciones,
  dividirPorUbicacion,
  edtDesdePresupuesto,
  eliminarActividades,
  eliminarNodo,
  moverNodo,
  repartoDelModelo,
  repartoIgual,
  rutaNodo,
  SIN_DATO,
} from "./edtProgramacion";
import { controlPorCuenta, controlPorPresupuesto, estadoElementos, estructuraPresupuesto, indicadores, lineaBaseDe, Medidor, pctTareaDelModelo } from "./avance";
import { calendarioInsumos, conTareas, enlazar, programacionVacia, programar, reglaDel100, tareasDe } from "./programacion";
import type { ItemPartida, PresupuestoDoc, Programacion } from "./types";
import { validarProgramacion } from "./validate";

const LV = { horasSemana: [8, 8, 8, 8, 8, 0, 0], jornada: 8, especiales: [] };

const partida = (id: string, metrado: number, rendimiento = 1): ItemPartida => ({
  id,
  tipo: "partida",
  nivel: 1,
  codigo: "",
  descripcion: id.toUpperCase(),
  unidad: "M3",
  omniclass: "",
  rendimiento,
  jornada: 8,
  componentes: [{ tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 1 }],
  metrado,
  origenId: null,
});

/** p1 (10 M3, 2 M3/day) and p2 (6 M3, 1 M3/day) under ESTRUCTURA; cement at 100.01 a unit. */
function base() {
  const doc: PresupuestoDoc = documentoVacio();
  doc.insumos = { cem: { codigo: "", descripcion: "CEMENTO", unidad: "BOL", precio: 100.01, tipo: "MT", iu: "", omniclass: "" } };
  doc.subpresupuestos[0].items = [{ id: "t1", tipo: "titulo", nivel: 0, descripcion: "ESTRUCTURA" }, partida("p1", 10, 2), partida("p2", 6, 1), partida("p3", 1, 1)];
  const r = resolverPresupuesto(doc);
  const calculados = new Map<string, SubpresupuestoCalculado>(doc.subpresupuestos.map((sp) => [sp.id, calcularSubpresupuesto(sp, r, () => null)]));
  const prog: Programacion = { ...programacionVacia("2026-10-05"), calendario: LV, tareas: { p2: { predecesoras: [{ id: "p1", tipo: "FC", desfase: 0 }], cuadrillas: 2 }, p3: { predecesoras: [{ id: "p2", tipo: "FC", desfase: 0 }] } } };
  return { doc, calculados, prog, spId: doc.subpresupuestos[0].id, r };
}

describe("la EDT de la programación", () => {
  it("se crea desde el presupuesto: los títulos son paquetes y cada partida una actividad con su mismo id", () => {
    const { doc, calculados, prog, spId } = base();
    const antes = programar(doc, calculados, prog);
    const edt = edtDesdePresupuesto(doc, prog);
    assert.deepEqual(
      edt.edt!.map((n) => [n.id, n.padre, n.nombre]),
      [
        [`sp-${spId}`, null, "PRESUPUESTO GENERAL"],
        ["t1", `sp-${spId}`, "ESTRUCTURA"],
      ]
    );
    assert.deepEqual(edt.actividades!.find((a) => a.id === "p2"), { predecesoras: [{ id: "p1", tipo: "FC", desfase: 0 }], cuadrillas: 2, id: "p2", nodo: "t1", nombre: "P2", asignaciones: [{ partida: "p2", pct: 100 }] });
    assert.deepEqual(edt.tareas, {});
    const despues = programar(doc, calculados, edt);
    assert.equal(despues.modo, "edt");
    assert.deepEqual(despues.alcances, [{ id: `sp-${spId}`, nombre: "PRESUPUESTO GENERAL" }]);
    assert.deepEqual(
      despues.filas.map((f) => [f.numero, f.tipo, f.descripcion, f.parcial]),
      [
        ["1", "titulo", "PRESUPUESTO GENERAL", 1700.17],
        ["1.1", "titulo", "ESTRUCTURA", 1700.17],
        ["1.1.1", "partida", "P1", 1000.1],
        ["1.1.2", "partida", "P2", 600.06],
        ["1.1.3", "partida", "P3", 100.01],
      ]
    );
    // The same durations, dates and links as when it followed the budget.
    for (const id of ["p1", "p2", "p3"]) {
      const a = antes.porId.get(id)!;
      const d = despues.porId.get(id)!;
      assert.deepEqual([d.duracion, d.inicio, d.fin, d.critica], [a.duracion, a.inicio, a.fin, a.critica]);
    }
    assert.equal(despues.fin, antes.fin);
  });

  it("una partida repartida en actividades: cantidades, costo al centavo y duración por lo que hace cada una", () => {
    const { doc, calculados, prog } = base();
    const p: Programacion = {
      ...prog,
      tareas: {},
      edt: [{ id: "n1", padre: null, nombre: "TORRE", responsable: "Ana", ubicacion: [{ columna: "bloque", valor: "T1" }] }],
      actividades: [
        { id: "a1", nodo: "n1", nombre: "Mitad 1", asignaciones: [{ partida: "p1", pct: 50 }] },
        { id: "a2", nodo: "n1", nombre: "Mitad 2 y p2", asignaciones: [{ partida: "p1", pct: 50 }, { partida: "p2", pct: 100 }] },
        { id: "a3", nodo: "n1", nombre: "Hito", asignaciones: [], duracion: 0 },
      ],
    };
    const res = programar(doc, calculados, p);
    const a1 = res.porId.get("a1")!;
    const a2 = res.porId.get("a2")!;
    assert.deepEqual([a1.metrado, a1.unidad, a1.parcial, a1.duracion], [5, "M3", 500.05, 3]); // 5 M3 ÷ 2 M3/day = 2.5 → 3
    assert.deepEqual([a2.metrado, a2.parcial, a2.duracion], [null, 1100.11, 9]); // 2.5 + 6 days, one after the other
    assert.equal(Math.round((a1.parcial + a2.parcial - 600.06) * 100) / 100, 1000.1); // p1 is split exactly
    assert.deepEqual([a1.responsable, a1.ubicacion], ["", [{ columna: "bloque", valor: "T1" }]]);
    assert.equal(res.porId.get("n1")!.responsable, "Ana");
    assert.equal(res.porId.get("a3")!.duracion, 0);
    // p3 is not in any activity: the 100 % rule says so.
    assert.deepEqual(
      reglaDel100(doc, calculados, p).faltan.map((f) => [f.partida, f.pct]),
      [["p3", 0]]
    );
    assert.match(res.avisos.join(" "), /Regla del 100 %: 1 partida/);
    // Resources over time follow each part.
    const insumos = calendarioInsumos(res, base().r, null, "mes");
    assert.equal(insumos.filas[0].cantidad, 16);
  });

  it("completa lo que falta en el paquete de su título, o en SIN CLASIFICAR", () => {
    const { doc, calculados, prog } = base();
    const edt = edtDesdePresupuesto(doc, prog);
    const parcial: Programacion = { ...edt, actividades: edt.actividades!.filter((a) => a.id !== "p3").map((a) => (a.id === "p2" ? { ...a, asignaciones: [{ partida: "p2", pct: 40 }] } : a)) };
    const r = completarAsignaciones(doc, calculados, parcial);
    assert.equal(r.agregadas, 2);
    assert.deepEqual(
      r.prog.actividades!.slice(-2).map((a) => [a.nodo, a.nombre, a.asignaciones]),
      [
        ["t1", "P2 (resto)", [{ partida: "p2", pct: 60 }]],
        ["t1", "P3", [{ partida: "p3", pct: 100 }]],
      ]
    );
    assert.equal(r.prog.actividades!.at(-1)!.id, "p3"); // its own id while it's free
    assert.deepEqual(reglaDel100(doc, calculados, r.prog), { faltan: [], sobran: [] });
    const sinTitulo = completarAsignaciones(doc, calculados, { ...parcial, edt: parcial.edt!.filter((n) => n.id !== "t1"), actividades: [] });
    assert.ok(sinTitulo.prog.edt!.some((n) => n.nombre === "SIN CLASIFICAR" && n.padre === null));
  });

  it("se edita el árbol sin perder actividades", () => {
    const { doc, prog } = base();
    const edt = edtDesdePresupuesto(doc, prog);
    const raiz = edt.edt![0].id;
    assert.equal(rutaNodo(edt.edt!, "t1"), "PRESUPUESTO GENERAL > ESTRUCTURA");
    assert.match(String((cambiarPadre(edt.edt!, raiz, "t1") as { error: string }).error), /dentro de sí mismo/);
    const sinT1 = eliminarNodo(edt, "t1") as Programacion;
    assert.deepEqual([...new Set(sinT1.actividades!.map((a) => a.nodo))], [raiz]);
    assert.match(String((eliminarNodo(sinT1, raiz) as { error: string }).error), /muévelas/);
    const dos = [...edt.edt!, { id: "t2", padre: raiz, nombre: "CUBIERTA", responsable: "", ubicacion: [] }];
    assert.deepEqual(moverNodo(dos, "t2", -1).map((n) => n.id), [raiz, "t2", "t1"]);
    const sinP2 = eliminarActividades(edt, new Set(["p2"]));
    assert.equal(sinP2.actividades!.find((a) => a.id === "p3")!.predecesoras, undefined); // the link to it goes too
  });
});

describe("dividir por ubicación", () => {
  const el = (itemId: string, cantidad: number | null, nivel?: string) => ({ itemId, cantidad, memoria: nivel === undefined ? null : { nivel } });

  it("reparte cada partida según sus elementos en el modelo, en orden natural", () => {
    const r = repartoDelModelo(
      [el("p1", 3, "PISO 1"), el("p1", 1, "PISO 10"), el("p1", 4, "PISO 2"), el("p1", 2), el("p2", null, "PISO 1"), el("p2", null, "PISO 2"), el("p2", null, "PISO 2"), el("zz", 1, "PISO 9")],
      ["p1", "p2", "p3"],
      "nivel"
    );
    assert.deepEqual(
      r.ubicaciones.map((u) => [u.valor, u.pcts]),
      [
        ["PISO 1", { p1: 30, p2: 33.3333 }],
        ["PISO 2", { p1: 40, p2: 66.6667 }], // by count: they don't measure
        ["PISO 10", { p1: 10 }],
        [SIN_DATO, { p1: 20 }],
      ]
    );
    assert.deepEqual(r.sinElementos, ["p3"]);
    assert.deepEqual(repartoIgual(["Piso A", "Piso B", "Piso C", " "], ["p3"]).map((u) => [u.valor, u.pcts.p3]), [
      ["Piso A", 33.3334],
      ["Piso B", 33.3333],
      ["Piso C", 33.3333],
    ]);
  });

  it("crea un paquete por piso y encadena el tren; los enlaces de antes pasan al tren", () => {
    const { doc, calculados, prog } = base();
    const edt = edtDesdePresupuesto(doc, prog);
    const r = dividirPorUbicacion(edt, {
      partidas: [
        { id: "p1", descripcion: "COLUMNAS" },
        { id: "p2", descripcion: "PLACA" },
      ],
      ubicaciones: [
        { valor: "PISO 1", pcts: { p1: 50, p2: 50 } },
        { valor: "PISO 2", pcts: { p1: 50, p2: 50 } },
      ],
      columna: "nivel",
      padre: "t1",
      nodoPorUbicacion: true,
      enCadaUbicacion: { desfase: 0 },
      entreUbicaciones: { desfase: 1 },
    });
    assert.deepEqual([r.creadas, r.reemplazadas], [4, 2]);
    const nodos = r.prog.edt!.filter((n) => n.padre === "t1");
    assert.deepEqual(nodos.map((n) => [n.nombre, n.ubicacion]), [
      ["PISO 1", [{ columna: "nivel", valor: "PISO 1" }]],
      ["PISO 2", [{ columna: "nivel", valor: "PISO 2" }]],
    ]);
    const por = new Map(r.prog.actividades!.map((a) => [a.nombre, a]));
    const id = (n: string) => por.get(n)!.id;
    assert.deepEqual(por.get("PLACA - PISO 1")!.predecesoras, [{ id: id("COLUMNAS - PISO 1"), tipo: "FC", desfase: 0 }]);
    assert.deepEqual(por.get("COLUMNAS - PISO 2")!.predecesoras, [{ id: id("COLUMNAS - PISO 1"), tipo: "FC", desfase: 1 }]);
    assert.deepEqual(por.get("PLACA - PISO 2")!.predecesoras, [
      { id: id("COLUMNAS - PISO 2"), tipo: "FC", desfase: 0 },
      { id: id("PLACA - PISO 1"), tipo: "FC", desfase: 1 },
    ]);
    // p3 came after p2: now after p2's last activity.
    assert.deepEqual(por.get("P3")!.predecesoras, [{ id: id("PLACA - PISO 2"), tipo: "FC", desfase: 0 }]);
    assert.ok(!r.prog.actividades!.some((a) => a.id === "p1" || a.id === "p2"));
    assert.deepEqual(reglaDel100(doc, calculados, r.prog), { faltan: [], sobran: [] });
    const res = programar(doc, calculados, r.prog);
    assert.equal(res.porId.get(id("COLUMNAS - PISO 1"))!.metrado, 5);
    assert.ok(res.porId.get(id("PLACA - PISO 2"))!.es >= res.porId.get(id("PLACA - PISO 1"))!.ef + 8); // one day after
  });
});

describe("validación de la EDT y de las actividades", () => {
  const prog = (edt: unknown, actividades: unknown) => ({ ...programacionVacia("2026-10-05"), edt, actividades });
  const nodo = (id: string, padre: string | null = null) => ({ id, padre, nombre: id.toUpperCase(), responsable: "", ubicacion: [] });
  const err = (f: () => unknown) => {
    try {
      f();
      return "";
    } catch (e) {
      return e instanceof ServiceError ? e.message : String(e);
    }
  };

  it("acepta una EDT bien formada y conserva los ajustes de cada actividad", () => {
    const v = validarProgramacion(prog([nodo("n1"), { ...nodo("n2", "n1"), ubicacion: [{ columna: "nivel", valor: " PISO 1 " }] }], [{ id: "a1", nodo: "n2", nombre: " Columnas ", asignaciones: [{ partida: "p1", pct: 33.333333 }], duracion: 2, predecesoras: [] }]));
    assert.deepEqual(v.edt![1].ubicacion, [{ columna: "nivel", valor: "PISO 1" }]);
    assert.deepEqual(v.actividades, [{ duracion: 2, id: "a1", nodo: "n2", nombre: "Columnas", asignaciones: [{ partida: "p1", pct: 33.3333 }] }]);
    assert.equal(validarProgramacion(programacionVacia("2026-10-05")).actividades, undefined);
  });

  it("rechaza padres que no existen, ciclos, paquetes perdidos y porcentajes imposibles", () => {
    assert.match(err(() => validarProgramacion(prog([nodo("n1", "zz")], []))), /no existe/);
    assert.match(err(() => validarProgramacion(prog([nodo("n1", "n2"), nodo("n2", "n1")], []))), /dentro de sí mismo/);
    assert.match(err(() => validarProgramacion(prog([nodo("n1")], [{ id: "a1", nodo: "zz", nombre: "A", asignaciones: [] }]))), /paquete que no existe/);
    assert.match(err(() => validarProgramacion(prog([nodo("n1")], [{ id: "a1", nodo: "n1", nombre: "A", asignaciones: [{ partida: "p1", pct: 120 }] }]))), /más del 100 %/);
    assert.match(err(() => validarProgramacion(prog([nodo("n1")], [{ id: "a1", nodo: "n1", nombre: "A", asignaciones: [{ partida: "p1", pct: 10 }, { partida: "p1", pct: 5 }] }]))), /repetida/);
    assert.match(err(() => validarProgramacion(prog([nodo("n1")], [{ id: "n1", nodo: "n1", nombre: "A", asignaciones: [] }]))), /repetido/);
  });

  it("los ajustes de las tareas se leen y escriben en las actividades", () => {
    const { doc, calculados, prog: p } = base();
    const edt = edtDesdePresupuesto(doc, p);
    const res = programar(doc, calculados, edt);
    const r = enlazar(tareasDe(edt), res, "p1", "p3");
    assert.ok("tareas" in r);
    const otra = conTareas(edt, (r as { tareas: Record<string, object> }).tareas);
    assert.deepEqual(otra.actividades!.find((a) => a.id === "p3")!.predecesoras, [
      { id: "p2", tipo: "FC", desfase: 0 },
      { id: "p1", tipo: "FC", desfase: 0 },
    ]);
    assert.deepEqual(otra.actividades!.find((a) => a.id === "p3")!.asignaciones, [{ partida: "p3", pct: 100 }]);
  });
});

describe("valor ganado con la EDT de la programación", () => {
  /** p1 split in PISO 1 and PISO 2 (50 % each), with Ana in charge of the structure; p2 and p3 as they were. */
  function plan() {
    const { doc, calculados, prog } = base();
    const edt = edtDesdePresupuesto(doc, prog);
    const conResponsable = { ...edt, edt: edt.edt!.map((n) => (n.id === "t1" ? { ...n, responsable: "Ana" } : n)) };
    const r = dividirPorUbicacion(conResponsable, {
      partidas: [{ id: "p1", descripcion: "COLUMNAS" }],
      ubicaciones: [
        { valor: "PISO 1", pcts: { p1: 50 } },
        { valor: "PISO 2", pcts: { p1: 50 } },
      ],
      columna: "nivel",
      padre: "t1",
      nodoPorUbicacion: true,
      enCadaUbicacion: null,
      entreUbicaciones: { desfase: 0 },
    });
    const res = programar(doc, calculados, r.prog);
    const lb = lineaBaseDe(res, r.prog);
    const id = (nombre: string) => r.prog.actividades!.find((a) => a.nombre === nombre)!.id;
    return { doc, calculados, lb, id, m: new Medidor(lb) };
  }

  it("la línea base guarda qué hace cada actividad de cada partida, dónde, y el responsable", () => {
    const { lb, id } = plan();
    const piso1 = lb.tareas.find((t) => t.id === id("COLUMNAS - PISO 1"))!;
    assert.deepEqual(piso1.asignaciones, [{ partida: "p1", pct: 50, costo: 500.05 }]);
    assert.deepEqual(piso1.ubicacion, [{ columna: "nivel", valor: "PISO 1" }]);
    assert.equal(lb.tareas.find((t) => t.id === "t1")!.responsable, "Ana");
    assert.equal(lb.total, 1700.17);
  });

  it("el avance del modelo y los colores se leen por partida y por piso", () => {
    const { lb, id } = plan();
    const e = (ifcGuid: string, nivel: string, cantidad: number, ejecutado: string | null = null) => ({ itemId: "p1", ifcGuid, modelId: "m", cantidad, memoria: { nivel }, ejecutado });
    const els = [e("g1", "PISO 1", 3, "2026-10-06"), e("g2", "PISO 1", 1), e("g3", "PISO 2", 4)];
    const porPartida = new Map([["p1", els]]);
    const t1 = lb.tareas.find((t) => t.id === id("COLUMNAS - PISO 1"))!;
    const t2 = lb.tareas.find((t) => t.id === id("COLUMNAS - PISO 2"))!;
    assert.equal(pctTareaDelModelo(t1, porPartida, "2026-10-07"), 75);
    assert.equal(pctTareaDelModelo(t2, porPartida, "2026-10-07"), 0);
    assert.equal(pctTareaDelModelo(t1, porPartida, "2026-10-05"), 0);
    // 2.5 days each, rounded up: PISO 1 from 05-10 to 07-10, PISO 2 from 08-10 to 12-10.
    assert.deepEqual([t1.inicio, t1.fin, t2.inicio, t2.fin], ["2026-10-05", "2026-10-07", "2026-10-08", "2026-10-12"]);
    const colores = estadoElementos(els, "2026-10-08", lb);
    assert.deepEqual([...colores].map(([g, x]) => [g, x.estado]), [
      ["g1", "ejecutado"],
      ["g2", "atrasado"], // its floor should have finished by 07-10
      ["g3", "en-curso"],
    ]);
  });

  it("el mismo valor ganado se lee por la EDT, por el presupuesto y por responsable", () => {
    const { doc, calculados, m, id } = plan();
    const corte = { id: "c1", fecha: "2026-10-07", nota: "", partidas: { [id("COLUMNAS - PISO 1")]: { pct: 100, costo: 600 } } };
    const total = indicadores(m, corte);
    assert.deepEqual([total.bac, total.ev, total.ac], [1700.17, 500.05, 600]);
    const cbs = controlPorPresupuesto(m, corte, estructuraPresupuesto(doc, calculados));
    const p1 = cbs.find((f) => f.id === "p1")!;
    assert.deepEqual([p1.bac, p1.ev, p1.ac, p1.pctReal], [1000.1, 500.05, 600, 50]);
    assert.deepEqual(
      [cbs.find((f) => f.id === "t1")!.ev, cbs.find((f) => f.tipo === "sp")!.bac],
      [500.05, 1700.17]
    );
    const cuentas = controlPorCuenta(m, corte);
    assert.deepEqual(
      cuentas.map((c) => [c.descripcion, c.responsable, c.bac, c.ev]),
      [["ESTRUCTURA", "Ana", 1700.17, 500.05]]
    );
  });
});
