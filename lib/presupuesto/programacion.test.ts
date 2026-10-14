import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import { calcularSubpresupuesto, SubpresupuestoCalculado } from "./calc";
import { agregarEspeciales, Calendario, festivosColombia, pascua } from "./calendario";
import { documentoVacio, resolverPresupuesto } from "./doc";
import {
  cambiarEnlace,
  enlazar,
  calendarioInsumos,
  calendarioValorizado,
  creaCiclo,
  curvaS,
  estimarDuracion,
  leerPredecesoras,
  periodos,
  programacionVacia,
  programar,
  repartir,
  textoPredecesoras,
} from "./programacion";
import { Ctx, getProgramacion, guardarProgramacion } from "./service";
import { memoryStore, PresupuestoStore } from "./store";
import type { Componente, Dependencia, ItemPartida, PresupuestoDoc, Programacion, TareaProgramada } from "./types";

const LV = { horasSemana: [8, 8, 8, 8, 8, 0, 0], jornada: 8, especiales: [] };

function partida(id: string, metrado: number, rendimiento: number, componentes: Componente[] = [{ tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 1 }], nivel = 1): ItemPartida {
  return { id, tipo: "partida", nivel, codigo: "", descripcion: id.toUpperCase(), unidad: "M2", omniclass: "", rendimiento, jornada: 8, componentes, metrado, origenId: null };
}

function documento(items: ItemPartida[]): PresupuestoDoc {
  const doc = documentoVacio();
  doc.insumos = {
    cem: { codigo: "", descripcion: "CEMENTO", unidad: "BOL", precio: 1000, tipo: "MT", iu: "", omniclass: "" },
    ofi: { codigo: "", descripcion: "OFICIAL", unidad: "HH", precio: 12000, tipo: "MO", iu: "", omniclass: "" },
    her: { codigo: "", descripcion: "HERRAMIENTAS MANUALES", unidad: "%MO", precio: 0, tipo: "EQ", iu: "", omniclass: "" },
  };
  doc.subpresupuestos[0].items = [{ id: "t1", tipo: "titulo", nivel: 0, descripcion: "ESTRUCTURA" }, ...items];
  return doc;
}

function calcular(doc: PresupuestoDoc): Map<string, SubpresupuestoCalculado> {
  const r = resolverPresupuesto(doc);
  return new Map(doc.subpresupuestos.map((sp) => [sp.id, calcularSubpresupuesto(sp, r, () => null)]));
}

function prog(inicio: string, tareas: Record<string, TareaProgramada> = {}, extra: Partial<Programacion> = {}): Programacion {
  return { ...programacionVacia(inicio), calendario: LV, tareas, ...extra };
}

const fc = (id: string, desfase = 0): Dependencia => ({ id, tipo: "FC", desfase });

describe("calendario laboral", () => {
  it("cuenta las horas de trabajo de cada día y salta fines de semana y festivos", () => {
    const cal = new Calendario({ horasSemana: [8, 8, 8, 8, 8, 4, 0], jornada: 8, especiales: [{ fecha: "2026-10-12", horas: 0, nombre: "Día de la Raza" }] }, "2026-10-05");
    assert.equal(cal.horaDe("2026-10-05"), 0);
    assert.equal(cal.horaDe("2026-10-10"), 40); // Monday to Friday
    assert.equal(cal.horaDe("2026-10-12"), 44); // + Saturday's 4
    assert.equal(cal.horaDe("2026-10-13"), 44); // the holiday adds nothing
    assert.equal(cal.fechaInicio(0), "2026-10-05");
    assert.equal(cal.fechaFin(40), "2026-10-09");
    assert.equal(cal.fechaInicio(40), "2026-10-10"); // the next hour is Saturday's
    assert.equal(cal.fechaFin(44), "2026-10-10");
    assert.equal(cal.fechaInicio(44), "2026-10-13"); // Sunday and the holiday are skipped
    assert.equal(cal.posicion(42, "fin"), 5.5); // half of Saturday
  });

  it("un inicio en día no laborable empieza el siguiente día hábil", () => {
    const cal = new Calendario(LV, "2026-10-03"); // Saturday
    assert.equal(cal.fechaInicio(0), "2026-10-05");
    assert.equal(cal.fechaFin(8), "2026-10-05");
  });

  it("no acepta un calendario sin horas de trabajo", () => {
    assert.throws(() => new Calendario({ horasSemana: [0, 0, 0, 0, 0, 0, 0], jornada: 8, especiales: [] }, "2026-10-05"), /ningún día/);
  });

  it("festivos de Colombia, con la Ley Emiliani", () => {
    assert.equal(pascua(2025), "2025-04-20");
    assert.equal(pascua(2026), "2026-04-05");
    assert.equal(pascua(2027), "2027-03-28");
    assert.deepEqual(
      festivosColombia(2026).map((f) => f.fecha.slice(5)),
      ["01-01", "01-12", "03-23", "04-02", "04-03", "05-01", "05-18", "06-08", "06-15", "06-29", "07-20", "08-07", "08-17", "10-12", "11-02", "11-16", "12-08", "12-25"]
    );
    const f2025 = festivosColombia(2025);
    assert.equal(f2025.length, 17); // two fall on 30-06-2025
    assert.equal(f2025.find((f) => f.fecha === "2025-06-30")!.nombre, "Sagrado Corazón y San Pedro y San Pablo");
    assert.ok(f2025.every((f) => f.horas === 0));
  });

  it("agregar festivos respeta los días que el usuario ya tenía", () => {
    const r = agregarEspeciales([{ fecha: "2026-01-12", horas: 4, nombre: "Medio día" }], festivosColombia(2026));
    assert.equal(r.agregados, 17);
    assert.equal(r.especiales.find((d) => d.fecha === "2026-01-12")!.horas, 4);
  });
});

describe("estimar la duración", () => {
  it("metrado ÷ (rendimiento × cuadrillas), redondeado según se elija", () => {
    const p = { metrado: 54, rendimiento: 20, jornada: 8 };
    assert.equal(estimarDuracion(p, 1, 8, "dia"), 3); // 2.7
    assert.equal(estimarDuracion(p, 1, 8, "medio"), 3);
    assert.equal(estimarDuracion(p, 1, 8, "no"), 2.7);
    assert.equal(estimarDuracion(p, 2, 8, "medio"), 1.5); // 1.35 with two crews
    assert.equal(estimarDuracion({ metrado: 300, rendimiento: 150, jornada: 8 }, 1, 8, "dia"), 2);
    assert.equal(estimarDuracion({ metrado: 600, rendimiento: 1200, jornada: 8 }, 1, 8, "dia"), 1); // at least one day
  });

  it("convierte la jornada de la partida a la del calendario", () => {
    // 10 units a day of 10 hours = 100 hours for 100 units = 12.5 days of 8 hours.
    assert.equal(estimarDuracion({ metrado: 100, rendimiento: 10, jornada: 10 }, 1, 8, "no"), 12.5);
  });

  it("sin metrado o sin rendimiento no se puede estimar", () => {
    assert.equal(estimarDuracion({ metrado: 0, rendimiento: 10, jornada: 8 }, 1, 8, "dia"), null);
    assert.equal(estimarDuracion({ metrado: 10, rendimiento: 0, jornada: 8 }, 1, 8, "dia"), null);
    assert.equal(estimarDuracion({ metrado: null, rendimiento: 10, jornada: 8 }, 1, 8, "dia"), null);
  });
});

describe("programación y ruta crítica", () => {
  const doc = documento([partida("p1", 300, 150), partida("p2", 54, 20), partida("p3", 100, 100), partida("p4", 400, 100)]);
  const calc = calcular(doc);

  it("calcula fechas, holguras y la ruta crítica con FC y CC con desfase", () => {
    const r = programar(doc, calc, prog("2026-10-05", { p2: { predecesoras: [fc("p1")] }, p3: { predecesoras: [{ id: "p1", tipo: "CC", desfase: 1 }] } }));
    const f = (id: string) => r.porId.get(id)!;
    assert.deepEqual(
      ["p1", "p2", "p3", "p4"].map((id) => [f(id).duracion, f(id).inicio, f(id).fin, f(id).holgura, f(id).critica]),
      [
        [2, "2026-10-05", "2026-10-06", 0, true],
        [3, "2026-10-07", "2026-10-09", 0, true],
        [1, "2026-10-06", "2026-10-06", 3, false],
        [4, "2026-10-05", "2026-10-08", 1, false],
      ]
    );
    assert.equal(r.fin, "2026-10-09");
    assert.equal(r.dias, 5);
    // The title and the subpresupuesto span their partidas.
    assert.deepEqual([f("t1").inicio, f("t1").fin, f("t1").duracion, f("t1").critica], ["2026-10-05", "2026-10-09", 5, true]);
    assert.equal(r.filas[0].tipo, "sp");
    assert.deepEqual(
      r.filas.map((x) => x.fila),
      [1, 2, 3, 4, 5, 6]
    );
    assert.deepEqual(f("p2").ancestros, [r.filas[0].id, "t1"]);
  });

  it("FF, CF y el adelanto (desfase negativo)", () => {
    const r = programar(
      doc,
      calc,
      prog("2026-10-05", {
        p3: { predecesoras: [{ id: "p1", tipo: "FF", desfase: 0 }] }, // 1 day, ends with p1 (Tuesday)
        p4: { duracion: 1, predecesoras: [{ id: "p1", tipo: "CF", desfase: 3 }] }, // ends 3 days after p1 starts
        p2: { predecesoras: [fc("p1", -1)] }, // starts one day before p1 ends
      })
    );
    const f = (id: string) => r.porId.get(id)!;
    assert.deepEqual([f("p3").inicio, f("p3").fin], ["2026-10-06", "2026-10-06"]);
    assert.deepEqual([f("p4").inicio, f("p4").fin], ["2026-10-07", "2026-10-07"]);
    assert.deepEqual([f("p2").inicio, f("p2").fin], ["2026-10-06", "2026-10-08"]);
  });

  it("un adelanto no puede empezar antes del inicio del proyecto", () => {
    const r = programar(doc, calc, prog("2026-10-05", { p2: { predecesoras: [fc("p1", -10)] } }));
    assert.equal(r.porId.get("p2")!.inicio, "2026-10-05");
  });

  it("respeta la fecha 'no comenzar antes de' y la duración escrita a mano", () => {
    const r = programar(doc, calc, prog("2026-10-05", { p4: { inicio: "2026-10-07", duracion: 2.5 } }));
    const p4 = r.porId.get("p4")!;
    assert.deepEqual([p4.inicio, p4.fin, p4.estimada, p4.estimacion], ["2026-10-07", "2026-10-09", false, 4]);
    assert.equal(r.porId.get("p1")!.estimada, true);
  });

  it("las cuadrillas acortan la duración estimada", () => {
    const r = programar(doc, calc, prog("2026-10-05", { p4: { cuadrillas: 2 } }));
    assert.equal(r.porId.get("p4")!.duracion, 2);
  });

  it("salta los fines de semana y los festivos", () => {
    const largo = documento([partida("p1", 600, 100)]); // 6 days
    const r = programar(largo, calcular(largo), prog("2026-10-05", {}, { calendario: { ...LV, especiales: [{ fecha: "2026-10-12", horas: 0, nombre: "Festivo" }] } }));
    assert.equal(r.porId.get("p1")!.fin, "2026-10-13");
  });

  it("ignora los ciclos y las predecesoras que ya no existen, y lo avisa", () => {
    const r = programar(
      doc,
      calc,
      prog("2026-10-05", { p1: { predecesoras: [fc("p2")] }, p2: { predecesoras: [fc("p1")] }, p3: { predecesoras: [fc("borrada"), fc("p2")] } })
    );
    assert.deepEqual([...r.enCiclo].sort(), ["p1", "p2"]);
    assert.ok(r.avisos.some((a) => /ciclo/.test(a)));
    assert.ok(r.avisos.some((a) => /ya no existen/.test(a)));
    // p1 and p2 start together (their loop is ignored); p3 still follows p2, which isn't in the loop with it.
    assert.deepEqual([r.porId.get("p1")!.inicio, r.porId.get("p2")!.inicio, r.porId.get("p3")!.inicio], ["2026-10-05", "2026-10-05", "2026-10-08"]);
  });

  it("avisa si termina después de la fecha fin", () => {
    const r = programar(doc, calc, prog("2026-10-05", {}, { finObjetivo: "2026-10-06" }));
    assert.ok(r.avisos.some((a) => /08-10-2026.*06-10-2026/.test(a)));
  });
});

describe("predecesoras escritas como texto", () => {
  const doc = documento([partida("p1", 300, 150), partida("p2", 54, 20), partida("p3", 100, 100)]);
  const r = programar(doc, calcular(doc), prog("2026-10-05"));

  it("lee filas con tipo y desfase, y las vuelve a escribir igual", () => {
    const x = leerPredecesoras("3; 4cc+2, 4ff", r, "p3", {});
    assert.ok("error" in x); // repeated row
    const y = leerPredecesoras("3; 4CC+2; ", r, "p3", {});
    assert.ok("deps" in y);
    assert.deepEqual(y.deps, [
      { id: "p1", tipo: "FC", desfase: 0 },
      { id: "p2", tipo: "CC", desfase: 2 },
    ]);
    const z = leerPredecesoras("3FC-1,5 días; 4SS", r, "p3", {});
    assert.ok("deps" in z);
    assert.deepEqual(z.deps, [
      { id: "p1", tipo: "FC", desfase: -1.5 },
      { id: "p2", tipo: "CC", desfase: 0 },
    ]);
    assert.equal(textoPredecesoras(z.deps, (id) => r.porId.get(id)?.fila), "3FC-1,5; 4CC");
    assert.equal(textoPredecesoras([fc("p1"), fc("ya-no")], (id) => r.porId.get(id)?.fila), "3");
  });

  it("rechaza filas que no son partidas, la propia, inexistentes, tipos raros y ciclos", () => {
    const error = (t: string, tareas: Record<string, TareaProgramada> = {}) => {
      const x = leerPredecesoras(t, r, "p3", tareas);
      return "error" in x ? x.error : "";
    };
    assert.match(error("2"), /título/);
    assert.match(error("1"), /subpresupuesto/);
    assert.match(error("5"), /propia/);
    assert.match(error("40"), /No existe/);
    assert.match(error("3XX"), /no es un tipo/);
    assert.match(error("abc"), /No se entiende/);
    assert.match(error("3", { p1: { predecesoras: [fc("p3")] } }), /ciclo/);
    assert.deepEqual(leerPredecesoras("", r, "p3", {}), { deps: [] });
  });

  it("detecta ciclos indirectos", () => {
    const tareas = { p2: { predecesoras: [fc("p3")] }, p1: { predecesoras: [fc("p2")] } };
    assert.equal(creaCiclo(tareas, "p3", ["p1"]), true); // p3 -> p2 -> p1 -> p3
    assert.equal(creaCiclo(tareas, "p3", []), false);
  });
});

describe("valores en el tiempo", () => {
  // 100 units at 10 a day = 10 working days from Monday 28-09-2026: 3 in September, 7 in October.
  const componentes: Componente[] = [
    { tipo: "insumo", id: "ofi", cuadrilla: 1, cantidad: 0 }, // 0.8 HH per unit
    { tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 2 },
    { tipo: "insumo", id: "her", cuadrilla: null, cantidad: 5 }, // 5 % of the labor
  ];
  const doc = documento([partida("p1", 100, 10, componentes)]);
  const calc = calcular(doc);
  const r = programar(doc, calc, prog("2026-09-28"));

  it("reparte el valor de cada partida según los días de trabajo de cada mes", () => {
    const cv = calendarioValorizado(r, null);
    assert.deepEqual(
      cv.periodos.map((x) => x.etiqueta),
      ["Sep-2026", "Oct-2026"]
    );
    const p1 = cv.filas.find((f) => f.fila.id === "p1")!;
    assert.equal(p1.fila.parcial, 1_208_000); // CU 9600 + 2000 + 480
    assert.deepEqual(p1.montos, [362_400, 845_600]);
    assert.deepEqual(cv.filas.find((f) => f.fila.id === "t1")!.montos, p1.montos);
    assert.deepEqual(cv.porcentajes, [30, 70]);
    assert.equal(cv.total, 1_208_000);
    // Choosing the subpresupuesto leaves its own row out.
    assert.deepEqual(
      calendarioValorizado(r, doc.subpresupuestos[0].id).filas.map((f) => f.fila.tipo),
      ["titulo", "partida"]
    );
  });

  it("curva S semanal y mensual", () => {
    const sem = curvaS(r, "semana");
    assert.deepEqual(
      sem.periodos.map((p) => p.desde),
      ["2026-09-28", "2026-10-05"]
    );
    assert.deepEqual(sem.montos, [604_000, 604_000]);
    assert.deepEqual(sem.porcentaje, [50, 100]);
    const mes = curvaS(r, "mes");
    assert.deepEqual(mes.acumulado, [362_400, 1_208_000]);
  });

  it("reparte cada insumo según las partidas que lo usan", () => {
    const ci = calendarioInsumos(r, resolverPresupuesto(doc), null);
    const por = new Map(ci.filas.map((f) => [f.descripcion, f]));
    assert.deepEqual(
      ci.filas.map((f) => f.descripcion),
      ["OFICIAL", "CEMENTO", "HERRAMIENTAS MANUALES"]
    );
    assert.deepEqual([por.get("OFICIAL")!.cantidad, por.get("OFICIAL")!.cantidades, por.get("OFICIAL")!.montos], [80, [24, 56], [288_000, 672_000]]);
    assert.deepEqual(por.get("CEMENTO")!.montos, [60_000, 140_000]);
    assert.deepEqual([por.get("HERRAMIENTAS MANUALES")!.porcentajeMO, por.get("HERRAMIENTAS MANUALES")!.montos], [true, [14_400, 33_600]]);
    assert.equal(ci.total, 1_208_000);
  });

  it("los periodos semanales empiezan el lunes", () => {
    const x = programar(doc, calc, prog("2026-10-07"));
    assert.equal(periodos(x, "semana")[0].desde, "2026-10-05");
  });

  it("repartir suma exactamente el total", () => {
    const partes = repartir(100, [1, 1, 1]);
    assert.equal(partes.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(repartir(0, [1, 2]), [0, 0]);
  });
});

describe("guardar la programación", () => {
  const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
  const lector: Caller = { id: "u3", name: "Marta", isAdmin: false, memberOfGroups: async () => new Set() };
  const ctx = (store: PresupuestoStore, caller: Caller): Ctx => ({ projectId: "obra1", caller, store, deps: { callerIn: async () => caller, projectName: async () => "" } });
  const valida = () => ({
    ...prog("2026-10-05", { p2: { predecesoras: [fc("p1", -1)], cuadrillas: 2 }, p3: { duracion: 0, inicio: "2026-10-07" }, p4: {} }),
    finObjetivo: "2026-12-31",
  });
  const rechaza = (e: unknown, status: number) => e instanceof ServiceError && e.status === status;

  it("solo quien edita la guarda; todos la ven; las tareas vacías no se guardan", async () => {
    const store = memoryStore();
    assert.deepEqual(await getProgramacion(ctx(store, lector)), { programacion: null, version: 0, updatedAt: null, updatedBy: null });
    await assert.rejects(guardarProgramacion(ctx(store, lector), { programacion: valida(), version: 0 }), (e) => rechaza(e, 403));
    assert.deepEqual(await guardarProgramacion(ctx(store, admin), { programacion: valida(), version: 0 }), { version: 1 });
    const r = await getProgramacion(ctx(store, lector));
    assert.equal(r.version, 1);
    assert.equal(r.updatedBy, "Ana");
    assert.deepEqual(Object.keys(r.programacion!.tareas).sort(), ["p2", "p3"]); // p4 had nothing
    assert.deepEqual(r.programacion!.tareas.p3, { duracion: 0, inicio: "2026-10-07" });
    await assert.rejects(guardarProgramacion(ctx(store, admin), { programacion: valida(), version: 0 }), (e) => rechaza(e, 409));
  });

  it("rechaza fechas, calendarios y enlaces no válidos", async () => {
    const intento = (cambio: (p: Programacion) => unknown) => {
      const p = valida();
      cambio(p);
      return guardarProgramacion(ctx(memoryStore(), admin), { programacion: p, version: 0 });
    };
    await assert.rejects(intento((p) => (p.inicio = "2026-02-30")), /fecha no válida/);
    await assert.rejects(intento((p) => (p.finObjetivo = "2026-01-01")), /anterior al inicio/);
    await assert.rejects(intento((p) => (p.calendario = { ...p.calendario, horasSemana: [0, 0, 0, 0, 0, 0, 0] })), /al menos un día/);
    await assert.rejects(intento((p) => (p.calendario = { ...p.calendario, horasSemana: [25, 8, 8, 8, 8, 0, 0] })), /máximo 24/);
    await assert.rejects(
      intento(
        (p) =>
          (p.calendario = {
            ...p.calendario,
            especiales: [
              { fecha: "2026-10-12", horas: 0, nombre: "A" },
              { fecha: "2026-10-12", horas: 4, nombre: "B" },
            ],
          })
      ),
      /repetido/
    );
    await assert.rejects(intento((p) => (p.tareas.p2.predecesoras = [{ id: "p1", tipo: "XX" as "FC", desfase: 0 }])), /FC, CC, FF o CF/);
    await assert.rejects(intento((p) => (p.tareas.p2.duracion = -1)), /mayor o igual a 0/);
    await assert.rejects(intento((p) => (p.redondeo = "raro" as "dia")), /Redondeo/);
  });
});

describe("enlazar arrastrando en el diagrama", () => {
  const doc = documento([partida("p1", 300, 150), partida("p2", 54, 20), partida("p3", 100, 100)]);
  const r = programar(doc, calcular(doc), prog("2026-10-05"));

  it("la actividad de origen queda como predecesora fin-comienzo de la de destino", () => {
    const x = enlazar({ p2: { cuadrillas: 2 } }, r, "p1", "p2");
    assert.ok("tareas" in x);
    assert.deepEqual(x.tareas.p2, { cuadrillas: 2, predecesoras: [fc("p1")] });
    const y = enlazar(x.tareas, r, "p2", "p3");
    assert.ok("tareas" in y);
    const nuevo = programar(doc, calcular(doc), prog("2026-10-05", y.tareas));
    assert.deepEqual(
      ["p1", "p2", "p3"].map((id) => nuevo.porId.get(id)!.inicio),
      ["2026-10-05", "2026-10-07", "2026-10-09"] // p2 lasts 2 days with its 2 crews
    );
  });

  it("no repite enlaces, no enlaza títulos ni a sí misma, y no deja hacer ciclos", () => {
    const tareas = { p2: { predecesoras: [fc("p1")] }, p3: { predecesoras: [fc("p2")] } };
    const error = (de: string, a: string) => {
      const x = enlazar(tareas, r, de, a);
      return "error" in x ? x.error : "";
    };
    assert.match(error("p1", "p2"), /ya es predecesora/);
    assert.match(error("t1", "p2"), /Solo se enlazan partidas/);
    assert.match(error("p2", "p2"), /propia/);
    assert.match(error("p3", "p1"), /ciclo/); // p1 -> p2 -> p3 -> p1
  });

  it("el diálogo de la flecha cambia el tipo y el retardo, o elimina el enlace", () => {
    const tareas = { p2: { duracion: 3, predecesoras: [fc("p1"), fc("p3")] }, p3: { predecesoras: [fc("p1")] } };
    const cambiada = cambiarEnlace(tareas, "p1", "p2", { tipo: "CC", desfase: -1 });
    assert.deepEqual(cambiada.p2.predecesoras, [{ id: "p1", tipo: "CC", desfase: -1 }, fc("p3")]);
    const sinUno = cambiarEnlace(tareas, "p3", "p2", null);
    assert.deepEqual(sinUno.p2, { duracion: 3, predecesoras: [fc("p1")] });
    const sinTarea = cambiarEnlace(tareas, "p1", "p3", null);
    assert.equal(sinTarea.p3, undefined); // nothing else was set
    assert.equal(cambiarEnlace(tareas, "p2", "p3", null), tareas); // no such link
  });
});
