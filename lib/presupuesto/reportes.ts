// The budget's printable tables, shared by the Excel and PDF exports.
import { FilaInsumo, FilaPieCalculada, parcialGasto, SubpresupuestoCalculado, totalGastos, totalTituloGasto } from "./calc";
import type { Tabla } from "./excel";
import { fmt } from "./format";
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
        celdas: [f.tipo, f.descripcion, f.unidad, f.porcentajeMO ? null : f.cantidad, f.porcentajeMO ? null : f.precio, f.parcial, ius[f.id] ?? ""],
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
