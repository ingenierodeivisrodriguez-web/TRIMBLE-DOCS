// The budget's printable tables, shared by the Excel and PDF exports.
import type { CurvaValorGanado, FilaControl } from "./avance";
import { FilaInsumo, FilaPieCalculada, parcialGasto, SubpresupuestoCalculado, totalGastos, totalTituloGasto } from "./calc";
import { fechaCorta } from "./calendario";
import type { Tabla } from "./excel";
import { fmt } from "./format";
import type { CalendarioValorizado, CurvaS, FilaInsumoPeriodo, Periodo, Programado } from "./programacion";
import { textoPredecesoras } from "./programacion";
import { GastosGenerales, RUBRO_NOMBRES, RUBROS } from "./types";

export function tablaPresupuesto(nombre: string, calc: SubpresupuestoCalculado, pie: FilaPieCalculada[], desglose: boolean): Tabla {
  const columnas: Tabla["columnas"] = [
    { header: "Item", width: 9 },
    { header: "Descripción", width: 60 },
    { header: "Und.", width: 8, align: "center" },
    { header: "Metrado", width: 12, decimales: 2 },
    { header: "CU", width: 12, decimales: 2 },
    { header: "Parcial", width: 15, decimales: 2 },
    ...(desglose ? RUBROS.map((r) => ({ header: RUBRO_NOMBRES[r], width: 14, decimales: 2 })) : []),
  ];
  const filas: Tabla["filas"] = calc.filas.map((f) => ({
    celdas: [
      f.numero,
      f.item.descripcion,
      f.item.tipo === "partida" ? f.item.unidad : "",
      f.metrado,
      f.cu,
      f.parcial,
      ...(desglose ? RUBROS.map((r) => f.rubros[r]) : []),
    ],
    negrita: f.item.tipo === "titulo",
    nivel: f.item.nivel,
  }));
  const vacio = desglose ? RUBROS.map(() => null) : [];
  filas.push({ celdas: ["", "", "", null, null, null, ...vacio] });
  filas.push({ celdas: ["CD", "COSTO DIRECTO", "", null, null, calc.cd, ...(desglose ? RUBROS.map((r) => calc.rubros[r]) : [])], negrita: true });
  for (const p of pie) {
    filas.push({ celdas: [p.fila.variable, p.fila.descripcion, "", null, null, p.error ? "Error" : p.valor, ...vacio], negrita: p.fila.resaltar });
  }
  return { titulo: `Presupuesto: ${nombre}`, hoja: nombre, columnas, filas };
}

export function tablaListaInsumos(nombre: string, filas: FilaInsumo[], ius: Record<string, string>): Tabla {
  const total = filas.reduce((sum, f) => sum + f.parcial, 0);
  return {
    titulo: `Lista de insumos: ${nombre}`,
    hoja: "Lista de insumos",
    columnas: [
      { header: "Tipo", width: 6, align: "center" },
      { header: "Insumo", width: 55 },
      { header: "Unidad", width: 9, align: "center" },
      { header: "Cantidad", width: 14, decimales: 3 },
      { header: "PU", width: 12, decimales: 2 },
      { header: "Parcial", width: 15, decimales: 2 },
      { header: "IU", width: 8, align: "center" },
    ],
    filas: [
      ...filas.map((f) => ({
        celdas: [f.tipo, f.descripcion, f.unidad, f.porcentaje ? null : f.cantidad, f.porcentaje ? null : f.precio, f.parcial, ius[f.id] ?? ""],
      })),
      { celdas: ["", "TOTAL", "", null, null, Math.round(total * 100) / 100, ""], negrita: true },
    ],
  };
}

export function tablaGastos(g: GastosGenerales, cdTotal: number): Tabla {
  const filas: Tabla["filas"] = [];
  const grupos: [string, typeof g.fijos][] = [
    ["GASTOS GENERALES FIJOS", g.fijos],
    ["GASTOS GENERALES VARIABLES", g.variables],
  ];
  grupos.forEach(([titulo, lista], gi) => {
    filas.push({ celdas: [String(gi + 1), titulo, "", null, null, lista.reduce((s, t) => s + totalTituloGasto(t), 0)], negrita: true });
    lista.forEach((t, ti) => {
      filas.push({ celdas: [`${gi + 1}.${ti + 1}`, t.descripcion, "", null, null, totalTituloGasto(t)], negrita: true, nivel: 1 });
      t.items.forEach((it, ii) => {
        const cantidad = t.formato === "personal" ? `${it.cantidad} × ${it.participacion}% × ${it.tiempo}` : it.cantidad;
        filas.push({ celdas: [`${gi + 1}.${ti + 1}.${ii + 1}`, it.descripcion, it.unidad, cantidad, it.precio, parcialGasto(it, t.formato)], nivel: 2 });
      });
    });
  });
  const tot = totalGastos(g);
  filas.push({ celdas: ["", "TOTAL GASTOS GENERALES", "", null, null, tot.total], negrita: true });
  const pct = cdTotal > 0 ? (tot.total / cdTotal) * 100 : 0;
  return {
    titulo: "Gastos generales",
    subtitulo: `GG = ${fmt(tot.total)} · ${pct.toFixed(4)}% del costo directo`,
    hoja: "Gastos generales",
    columnas: [
      { header: "Item", width: 9 },
      { header: "Descripción", width: 55 },
      { header: "Unidad", width: 9, align: "center" },
      { header: "Cantidad", width: 16, align: "right" },
      { header: "Precio", width: 13, decimales: 2 },
      { header: "Parcial", width: 15, decimales: 2 },
    ],
    filas,
  };
}

// ---------------------------------------------------------------- schedule

export function tablaProgramacion(p: Programado, proyecto: string): Tabla {
  const filaDe = (id: string) => p.porId.get(id)?.fila;
  return {
    titulo: `Programación: ${proyecto}`,
    subtitulo: `Inicio ${fechaCorta(p.inicio)} · Fin ${fechaCorta(p.fin)} · ${fmt(p.dias)} días hábiles`,
    hoja: "Programación",
    columnas: [
      { header: "Fila", width: 6, align: "center" },
      { header: "Item", width: 9 },
      { header: "Partida", width: 55 },
      { header: "Duración (días)", width: 11, decimales: 2 },
      { header: "Inicio", width: 12, align: "center" },
      { header: "Fin", width: 12, align: "center" },
      { header: "Predecesoras", width: 16 },
      { header: "Cuadrillas", width: 10, decimales: 2 },
      { header: "Rendimiento", width: 12, decimales: 2 },
      { header: "Metrado", width: 12, decimales: 2 },
      { header: "Holgura (días)", width: 11, decimales: 2 },
      { header: "Ruta crítica", width: 10, align: "center" },
    ],
    filas: p.filas.map((f) => ({
      celdas: [
        f.fila,
        f.tipo === "sp" ? "SP" : f.numero,
        f.descripcion,
        f.vacia ? null : f.duracion,
        f.vacia ? "" : fechaCorta(f.inicio),
        f.vacia ? "" : fechaCorta(f.fin),
        f.tipo === "partida" ? textoPredecesoras(f.predecesoras, filaDe) : "",
        f.tipo === "partida" ? f.cuadrillas : null,
        f.rendimiento,
        f.metrado,
        f.vacia ? null : f.holgura,
        f.critica ? "Sí" : "",
      ],
      negrita: f.tipo !== "partida",
      nivel: f.nivel,
    })),
  };
}

const cabeceraPeriodo = (x: Periodo, pct?: number) => (pct === undefined ? x.etiqueta : `${x.etiqueta} (${fmt(pct, 3)}%)`);

export function tablaCalendarioValorizado(cv: CalendarioValorizado, nombre: string): Tabla {
  return {
    titulo: `Calendario valorizado: ${nombre}`,
    hoja: "Calendario valorizado",
    columnas: [
      { header: "Item", width: 9 },
      { header: "Partida", width: 55 },
      { header: "Unidad", width: 8, align: "center" },
      { header: "Metrado", width: 12, decimales: 2 },
      { header: "PU", width: 12, decimales: 2 },
      { header: "Parcial", width: 15, decimales: 2 },
      ...cv.periodos.map((x, i) => ({ header: cabeceraPeriodo(x, cv.porcentajes[i]), width: 15, decimales: 2 })),
    ],
    filas: [
      ...cv.filas.map((f) => ({
        celdas: [f.fila.tipo === "sp" ? "SP" : f.fila.numero, f.fila.descripcion, f.fila.unidad, f.fila.metrado, f.fila.cu, f.fila.parcial, ...f.montos],
        negrita: f.fila.tipo !== "partida",
        nivel: f.fila.nivel,
      })),
      { celdas: ["", "TOTAL", "", null, null, cv.total, ...cv.totales], negrita: true },
    ],
  };
}

export function tablaCalendarioInsumos(c: { periodos: Periodo[]; filas: FilaInsumoPeriodo[]; totales: number[]; total: number }, nombre: string, modo: "costo" | "cantidad"): Tabla {
  return {
    titulo: `Calendario de insumos (${modo === "costo" ? "costo" : "cantidades"}): ${nombre}`,
    hoja: "Calendario de insumos",
    columnas: [
      { header: "Tipo", width: 6, align: "center" },
      { header: "Insumo", width: 50 },
      { header: "Unidad", width: 8, align: "center" },
      { header: "Cantidad", width: 14, decimales: 3 },
      { header: "PU", width: 12, decimales: 2 },
      { header: "Parcial", width: 15, decimales: 2 },
      ...c.periodos.map((x) => ({ header: x.etiqueta, width: 15, decimales: modo === "costo" ? 2 : 3 })),
    ],
    filas: [
      ...c.filas.map((f) => ({
        celdas: [
          f.tipo,
          f.descripcion,
          f.unidad,
          f.porcentaje ? null : f.cantidad,
          f.porcentaje ? null : f.precio,
          f.parcial,
          ...(modo === "costo" ? f.montos : f.porcentaje ? f.montos : f.cantidades),
        ],
      })),
      ...(modo === "costo" ? [{ celdas: ["", "TOTAL", "", null, null, c.total, ...c.totales], negrita: true }] : []),
    ],
  };
}

export function tablaCurvaS(cs: CurvaS, nombre: string, tipo: "semana" | "mes"): Tabla {
  return {
    titulo: `Curva S (${tipo === "semana" ? "semanal" : "mensual"}): ${nombre}`,
    hoja: "Curva S",
    columnas: [
      { header: "Periodo", width: 18 },
      { header: "Desde", width: 12, align: "center" },
      { header: "Hasta", width: 12, align: "center" },
      { header: "Valor del periodo", width: 16, decimales: 2 },
      { header: "Acumulado", width: 16, decimales: 2 },
      { header: "% acumulado", width: 12, decimales: 2 },
    ],
    filas: cs.periodos.map((x, i) => ({ celdas: [x.etiqueta, fechaCorta(x.desde), fechaCorta(x.hasta), cs.montos[i], cs.acumulado[i], cs.porcentaje[i]] })),
  };
}

/** Earned value at a cut, row by row (titles add up their partidas), and the curve over time. */
export function tablasValorGanado(
  filas: FilaControl[],
  curva: CurvaValorGanado,
  fecha: string,
  lineaBase: string,
  tipo: "semana" | "mes"
): Tabla[] {
  const estados = { "sin-iniciar": "Sin iniciar", atrasada: "Atrasada", "al-dia": "Al día", adelantada: "Adelantada", terminada: "Terminada" } as const;
  return [
    {
      titulo: `Valor ganado al ${fechaCorta(fecha)} · línea base: ${lineaBase}`,
      hoja: "Valor ganado",
      columnas: [
        { header: "Item", width: 9 },
        { header: "Descripción", width: 50 },
        { header: "Inicio LB", width: 12, align: "center" },
        { header: "Fin LB", width: 12, align: "center" },
        { header: "Costo LB (BAC)", width: 16, decimales: 2 },
        { header: "Valor planeado (PV)", width: 16, decimales: 2 },
        { header: "Valor ganado (EV)", width: 16, decimales: 2 },
        { header: "Costo real (AC)", width: 16, decimales: 2 },
        { header: "% planeado", width: 11, decimales: 2 },
        { header: "% real", width: 11, decimales: 2 },
        { header: "SPI", width: 8, decimales: 3 },
        { header: "CPI", width: 8, decimales: 3 },
        { header: "Estado", width: 12 },
      ],
      filas: filas.map((f) => ({
        celdas: [
          f.tarea.tipo === "sp" ? "SP" : f.tarea.numero,
          f.tarea.descripcion,
          fechaCorta(f.tarea.inicio),
          fechaCorta(f.tarea.fin),
          f.bac,
          f.pv,
          f.ev,
          f.ac,
          f.pctPlaneado,
          f.pctReal,
          f.spi,
          f.cpi,
          estados[f.estado],
        ],
        negrita: f.tarea.tipo !== "partida",
        nivel: f.tarea.nivel,
      })),
    },
    {
      titulo: `Curva S planeada y real (${tipo === "semana" ? "semanal" : "mensual"}) · línea base: ${lineaBase}`,
      hoja: "Curva S real",
      columnas: [
        { header: "Periodo", width: 18 },
        { header: "Desde", width: 12, align: "center" },
        { header: "Hasta", width: 12, align: "center" },
        { header: "Planeado acumulado (PV)", width: 18, decimales: 2 },
        { header: "Ganado acumulado (EV)", width: 18, decimales: 2 },
        { header: "Costo real acumulado (AC)", width: 18, decimales: 2 },
        { header: "% planeado", width: 11, decimales: 2 },
        { header: "% real", width: 11, decimales: 2 },
      ],
      filas: curva.puntos.map((p) => ({
        celdas: [
          p.periodo.etiqueta,
          fechaCorta(p.periodo.desde),
          fechaCorta(p.periodo.hasta),
          p.pv,
          p.ev,
          p.ac,
          curva.bac ? Math.round((p.pv / curva.bac) * 10000) / 100 : null,
          curva.bac && p.ev !== null ? Math.round((p.ev / curva.bac) * 10000) / 100 : null,
        ],
      })),
    },
  ];
}
