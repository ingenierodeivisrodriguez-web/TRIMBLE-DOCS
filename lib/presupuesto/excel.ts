// Excel in the browser (ExcelJS, loaded on demand): the import template (also
// used to export the catalogs, so they can be edited and imported back),
// reading an uploaded workbook, and exporting tables.
import type { Workbook, Worksheet } from "exceljs";
import type { Celda, Hoja, Libro } from "./importar";
import { TABLA_22 } from "./omniclass";
import type { Insumo, PartidaCatalogo } from "./types";

async function excelJs() {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs"); Workbook?: unknown };
  return (mod.default ?? mod) as typeof import("exceljs");
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function descargarLibro(wb: Workbook, nombre: string) {
  const buffer = await wb.xlsx.writeBuffer();
  descargar(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre);
}

/** "Lista de insumos: ESTRUCTURAS" -> a safe file / sheet name. */
export function nombreSeguro(text: string, max = 80): string {
  return text.replace(/[\\/:*?"<>|[\]]+/g, "-").replace(/\s+/g, " ").trim().slice(0, max) || "Presupuesto";
}

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF2F55B0" } };

function encabezado(ws: Worksheet, headers: string[], widths: number[]) {
  ws.addRow(headers);
  const row = ws.getRow(ws.rowCount);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: ws.rowCount }];
}

// ---------------------------------------------------------------- template

const INSTRUCCIONES = [
  "Plantilla de importación de catálogos · Presupuesto",
  "",
  "Hoja Insumos: un insumo por fila. Tipo: MO (mano de obra), MT (materiales), EQ (equipos y herramientas) o SC (subcontratos).",
  "  Los insumos se reconocen por su Código; sin código, por Descripción + Unidad. Si ya existen se actualizan, si no se crean.",
  "  Herramientas que se cobran como % de la mano de obra: unidad %MO (en el APU, su cantidad es el porcentaje).",
  "Hoja Partidas: una partida por fila, con su Rendimiento (unidades por día) y Jornada (horas), y los datos de su diccionario EDT:",
  "  Descripción del trabajo, Criterios de aceptación y Responsable (opcionales; si las columnas están, lo que dejes en blanco borra el dato guardado).",
  "  Las partidas necesitan Código para poder llevar insumos.",
  "Hoja Insumos de partida (antes APU): una fila por cada insumo o subpartida de una partida; es lo que arma su análisis de precios unitarios.",
  "  Código partida = el código de la hoja Partidas (o de una partida que ya está en el catálogo).",
  "  Tipo: INSUMO o SUBPARTIDA. Código = código del insumo (o de la partida usada como subpartida). Sin código, Descripción + Unidad del insumo.",
  "  Cuadrilla: para mano de obra y equipos por hora (cantidad = cuadrilla × jornada ÷ rendimiento). Sin cuadrilla, se usa la Cantidad.",
  "  Las filas del APU de una partida reemplazan todo su análisis anterior.",
  "Hoja OmniClass: códigos y títulos de las tablas OmniClass que quieras usar (además de las divisiones de la Tabla 22 que trae la app).",
  "",
  "No cambies los nombres de las hojas ni de los encabezados. Las filas vacías se ignoran.",
];

/**
 * The import template: empty with examples, or filled with a catalog (to
 * edit it in Excel and import it back).
 */
export async function plantillaCatalogo(catalogo: { insumos: Insumo[]; partidas: PartidaCatalogo[] } | null, nombre: string) {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("Instrucciones");
  INSTRUCCIONES.forEach((line, i) => {
    info.addRow([line]);
    if (i === 0) info.getRow(1).font = { bold: true, size: 14 };
  });
  info.getColumn(1).width = 140;

  const ins = wb.addWorksheet("Insumos");
  encabezado(ins, ["Código", "Descripción", "Unidad", "Precio", "Tipo", "IU", "OmniClass"], [14, 60, 10, 14, 8, 10, 18]);
  const insumos = catalogo?.insumos ?? [];
  if (catalogo) for (const i of insumos) ins.addRow([i.codigo, i.descripcion, i.unidad, i.precio, i.tipo, i.iu, i.omniclass]);
  else {
    ins.addRow(["MO-001", "PEON", "HH", 16.5, "MO", "47", ""]);
    ins.addRow(["MT-001", "CEMENTO PORTLAND TIPO I (42.5KG)", "BOL", 22.2, "MT", "21", ""]);
    ins.addRow(["EQ-001", "HERRAMIENTAS MANUALES", "%MO", 0, "EQ", "37", ""]);
  }
  ins.getColumn(4).numFmt = "#,##0.00";

  const par = wb.addWorksheet("Partidas");
  encabezado(
    par,
    ["Código", "Descripción", "Unidad", "Rendimiento", "Jornada (h)", "OmniClass", "Descripción del trabajo", "Criterios de aceptación", "Responsable"],
    [14, 60, 10, 14, 12, 18, 50, 50, 26]
  );
  const apu = wb.addWorksheet("Insumos de partida");
  encabezado(apu, ["Código partida", "Tipo", "Código insumo o subpartida", "Descripción", "Unidad", "Cuadrilla", "Cantidad"], [16, 12, 24, 50, 10, 12, 12]);
  if (catalogo) {
    const insMap = new Map(insumos.map((i) => [i.id, i]));
    const parMap = new Map(catalogo.partidas.map((p) => [p.id, p]));
    for (const p of catalogo.partidas) {
      par.addRow([p.codigo, p.descripcion, p.unidad, p.rendimiento, p.jornada, p.omniclass, p.edt?.descripcion ?? "", p.edt?.criterios ?? "", p.edt?.responsable ?? ""]);
      if (!p.codigo) continue;
      for (const c of p.componentes) {
        const ref = c.tipo === "insumo" ? insMap.get(c.id) : parMap.get(c.id);
        if (!ref) continue;
        apu.addRow([p.codigo, c.tipo === "insumo" ? "INSUMO" : "SUBPARTIDA", ref.codigo, ref.descripcion, ref.unidad, c.cuadrilla, c.cantidad]);
      }
    }
  } else {
    par.addRow(["P-001", "TRAZO Y REPLANTEO", "M2", 50, 8, "22-01 00 00", "Trazo de ejes y niveles con equipo topográfico", "Tolerancia ±5 mm; planos de replanteo firmados", "Ing. Topógrafo"]);
    apu.addRow(["P-001", "INSUMO", "MO-001", "PEON", "HH", 4, null]);
    apu.addRow(["P-001", "INSUMO", "EQ-001", "HERRAMIENTAS MANUALES", "%MO", null, 5]);
  }

  const omni = wb.addWorksheet("OmniClass");
  encabezado(omni, ["Código", "Título"], [18, 70]);
  for (const e of TABLA_22) omni.addRow([e.codigo, e.titulo]);

  await descargarLibro(wb, nombre);
}

// ---------------------------------------------------------------- reading

function celda(value: unknown): Celda {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  const v = value as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
  if (v.richText) return v.richText.map((t) => t.text).join("");
  if ("result" in v) return celda(v.result);
  if (typeof v.text === "string") return v.text;
  return null;
}

function leerHoja(ws: Worksheet): Hoja {
  const rows: Hoja = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    rows.push(values.slice(1).map(celda));
  });
  return rows;
}

const HOJAS: Record<keyof Libro, string[]> = {
  insumos: ["insumos", "catalogo de insumos"],
  partidas: ["partidas", "catalogo de partidas"],
  apu: ["insumos de partida", "apu", "analisis", "analisis de precios unitarios"],
  omniclass: ["omniclass", "codigos omniclass"],
};

/** Reads the template's sheets (by name, ignoring case and accents). */
export async function leerLibro(buffer: ArrayBuffer): Promise<Libro> {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const libro: Libro = {};
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  wb.eachSheet((ws) => {
    const name = fold(ws.name);
    for (const [key, names] of Object.entries(HOJAS) as [keyof Libro, string[]][]) {
      if (!libro[key] && names.includes(name)) libro[key] = leerHoja(ws);
    }
  });
  return libro;
}

// ---------------------------------------------------------------- tables

export interface Columna {
  header: string;
  /** Width in characters (Excel) and relative width (PDF). */
  width: number;
  align?: "left" | "right" | "center";
  /** Decimals, for numeric columns. */
  decimales?: number;
}

export interface FilaTabla {
  celdas: (string | number | null)[];
  negrita?: boolean;
  /** Indentation of the first text column. */
  nivel?: number;
}

export interface Tabla {
  titulo: string;
  subtitulo?: string;
  hoja: string;
  columnas: Columna[];
  filas: FilaTabla[];
}

export async function exportarExcel(tablas: Tabla[], nombre: string) {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  for (const t of tablas) {
    const ws = wb.addWorksheet(nombreSeguro(t.hoja, 31));
    ws.addRow([t.titulo]);
    ws.getRow(1).font = { bold: true, size: 14 };
    if (t.subtitulo) ws.addRow([t.subtitulo]);
    ws.addRow([]);
    encabezado(
      ws,
      t.columnas.map((c) => c.header),
      t.columnas.map((c) => c.width)
    );
    for (const f of t.filas) {
      ws.addRow(f.celdas);
      const row = ws.getRow(ws.rowCount);
      if (f.negrita) row.font = { bold: true };
      t.columnas.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c.decimales !== undefined) cell.numFmt = c.decimales === 0 ? "#,##0" : `#,##0.${"0".repeat(c.decimales)}`;
        cell.alignment = { horizontal: c.align ?? (c.decimales !== undefined ? "right" : "left"), indent: i === 1 && f.nivel ? f.nivel : undefined };
      });
    }
  }
  await descargarLibro(wb, nombre);
}

