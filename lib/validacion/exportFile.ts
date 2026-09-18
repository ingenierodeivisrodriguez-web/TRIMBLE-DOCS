import ExcelJS from "exceljs";
import type { Selection } from "./select";
import { NonConformingRow, TEMPLATE_TITLES, UnclassifiedRow } from "./types";

export interface Table {
  sheetName: string;
  headers: string[];
  rows: string[][];
  columnWidths: number[];
}

export function nonConformingTable(rows: NonConformingRow[]): Table {
  return {
    sheetName: "No conformes",
    headers: ["Archivo", "Carpeta", "Plantilla", "Campo(s) que fallaron", "Motivo"],
    columnWidths: [45, 40, 24, 32, 90],
    rows: rows.map((row) => [
      row.name,
      row.folderPath,
      TEMPLATE_TITLES[row.template],
      [...new Set(row.issues.map((i) => i.fieldLabel))].join(", "),
      row.issues.map((i) => i.message).join(" | "),
    ]),
  };
}

export function unclassifiedTable(rows: UnclassifiedRow[]): Table {
  return {
    sheetName: "Sin clasificar",
    headers: ["Archivo", "Carpeta", "Extensión"],
    columnWidths: [45, 40, 16],
    rows: rows.map((row) => [row.name, row.folderPath, row.ext === "sin-extension" ? "(sin extensión)" : row.ext]),
  };
}

export function tableFor(selection: Selection): Table {
  return selection.tab === "nonconforming"
    ? nonConformingTable(selection.rows)
    : unclassifiedTable(selection.rows);
}

// A cell starting with one of these is interpreted as a formula by Excel; file
// names are untrusted input, so neutralise them (CSV injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 CSV with a BOM so Excel reads accents correctly. */
export function toCsv(table: Table): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(table: Table): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Validación - Trimble Connect";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(table.sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = table.headers.map((header, i) => ({
    header,
    key: `c${i}`,
    width: table.columnWidths[i] ?? 30,
  }));
  for (const row of table.rows) sheet.addRow(row);

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B5FA5" } };
  header.alignment = { vertical: "middle" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.headers.length } };

  const written = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(new ArrayBuffer(written.byteLength));
  bytes.set(new Uint8Array(written));
  return bytes;
}
