// The parameter catalog in Excel (browser, ExcelJS loaded on demand): the
// DYCO list's columns first, in its order, then the ones this app adds, so
// the file can be edited and imported back.
import type { Workbook } from "exceljs";
import { descargar, nombreSeguro } from "../presupuesto/excel";
import { plegar } from "../presupuesto/format";
import { Celda, COLUMNAS_EXCEL, NOMBRE_CAMPO, textoCampo } from "./importar";
import type { GrupoTdi, NivelNdi, Parametro } from "./types";

async function excelJs() {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
  return (mod.default ?? mod) as typeof import("exceljs");
}

export const HOJA_PARAMETROS = "1. Lista de parámetros DYCO";

const ANCHOS: Partial<Record<(typeof COLUMNAS_EXCEL)[number], number>> = { numero: 6, tdi: 8, ndi: 8, origen: 12, nombre: 40, descripcion: 70, codigo: 12, alias: 60, valoresPermitidos: 40 };

const INSTRUCCIONES = [
  "Catálogo de parámetros · Requisitos BIM (LOIN)",
  "",
  "Hoja \"1. Lista de parámetros DYCO\": un parámetro por fila. Las seis primeras columnas son las del listado DYCO (N°, TDI, NDI, Dato, Parámetro, Descripción).",
  "  TDI: TDI-A, TDI-B… (los nombres de los grupos están en la hoja Grupos TDI). NDI: NDI-1, NDI-2… (los niveles del catálogo están en la hoja Niveles NDI; acumulativo).",
  "  Dato: \"A ingresar\" (lo escribe el modelador), \"Automática\" (sale de la geometría o del software) o vacío (por definir).",
  "Columnas que agrega la app (opcionales al importar; si una columna no está, ese dato no se toca):",
  "  Código interno (único). Tipo de dato: Texto, Número, Sí / No, Fecha o Lista de valores.",
  "  Valores permitidos: separados por punto y coma (;). Mínimo y Máximo: para números. Patrón: expresión regular para texto.",
  "  Equivalencias de lectura: dónde buscar el parámetro en el modelo, en orden de preferencia, separadas por punto y coma:",
  "    Pset_WallCommon.LoadBearing · Datos de identidad.Capacidad de carga · *.Capacidad de carga (cualquier grupo) · @Name (atributo IFC).",
  "    Las que propuso la app llevan \"(sugerida)\" hasta que alguien las confirme.",
  "  Activo: Sí / No. Los parámetros no se borran: se desactivan.",
  "",
  "Al importar, los parámetros se reconocen por su Código; si no tiene, por su N° y luego por su nombre.",
  "Lo que cambiaría un parámetro existente se muestra antes de guardar, para que decidas fila por fila.",
];

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF2F55B0" } };

/** The catalog (or an empty template) as an Excel file. */
export async function exportarCatalogo(parametros: Parametro[], grupos: GrupoTdi[], niveles: NivelNdi[], nombre: string) {
  const buffer = await libroCatalogo(parametros, grupos, niveles);
  descargar(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre);
}

/** The workbook's bytes (kept apart from the download so it can be tested). */
export async function libroCatalogo(parametros: Parametro[], grupos: GrupoTdi[], niveles: NivelNdi[]): Promise<ArrayBuffer> {
  const ExcelJS = await excelJs();
  const wb: Workbook = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(nombreSeguro(HOJA_PARAMETROS, 31));
  ws.addRow(COLUMNAS_EXCEL.map((c) => NOMBRE_CAMPO[c]));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  COLUMNAS_EXCEL.forEach((c, i) => (ws.getColumn(i + 1).width = ANCHOS[c] ?? 14));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const p of parametros) {
    ws.addRow(
      COLUMNAS_EXCEL.map((c): Celda => {
        if (c === "numero") return p.numero;
        if (c === "min" || c === "max") return p.regla[c];
        return textoCampo(c, p);
      })
    );
    ws.getRow(ws.rowCount).alignment = { vertical: "top", wrapText: true };
  }

  const g = wb.addWorksheet("Grupos TDI");
  g.addRow(["TDI", "Nombre"]);
  g.getRow(1).font = { bold: true };
  for (const x of grupos) g.addRow([`TDI-${x.codigo}`, x.nombre]);
  g.getColumn(1).width = 10;
  g.getColumn(2).width = 50;

  const n = wb.addWorksheet("Niveles NDI");
  n.addRow(["NDI", "Nombre"]);
  n.getRow(1).font = { bold: true };
  for (const x of niveles) n.addRow([`NDI-${x.numero}`, x.nombre]);
  n.getColumn(1).width = 10;
  n.getColumn(2).width = 50;

  const info = wb.addWorksheet("Instrucciones");
  INSTRUCCIONES.forEach((line) => info.addRow([line]));
  info.getRow(1).font = { bold: true, size: 14 };
  info.getColumn(1).width = 140;

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function celda(value: unknown): Celda {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  const v = value as { result?: unknown; richText?: { text: string }[]; text?: string };
  if (v.richText) return v.richText.map((t) => t.text).join("");
  if ("result" in v) return celda(v.result);
  if (typeof v.text === "string") return v.text;
  return null;
}

/**
 * The sheet with the parameters: the one named like the DYCO list, or else
 * the first one with a "Parámetro" column. Null when there is none.
 */
export async function leerLibroParametros(buffer: ArrayBuffer): Promise<Celda[][] | null> {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const hojas: { nombre: string; filas: Celda[][] }[] = [];
  wb.eachSheet((ws) => {
    const filas: Celda[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => filas.push((row.values as unknown[]).slice(1).map(celda)));
    hojas.push({ nombre: plegar(ws.name), filas });
  });
  const tieneParametro = (filas: Celda[][]) => filas.slice(0, 15).some((f) => f.some((c) => plegar(String(c ?? "")).replace(/[^a-z]/g, "") === "parametro"));
  const porNombre = hojas.find((h) => /lista de parametros/.test(h.nombre) && tieneParametro(h.filas));
  return (porNombre ?? hojas.find((h) => tieneParametro(h.filas)))?.filas ?? null;
}
