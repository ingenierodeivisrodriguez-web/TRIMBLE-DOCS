// The LOIN matrix for the BEP (browser; ExcelJS and jsPDF loaded on demand):
// an Excel book (the colored matrix, one row per cell, the information each
// element must carry at each stage, and the stages) and a landscape PDF of
// the colored matrix with its legend.
import { pdfSafe } from "../graficos/pdfReport";
import { descargar, nombreSeguro } from "../presupuesto/excel";
import { textoListaAlias } from "./alias";
import { clave, colorCelda, COLOR_LOD, COLOR_SOLO_NDI, DESCRIPCION_LOD, exigeAlgo, fechaCorta, GrupoMatriz, parametrosExigidos, textoCelda } from "./matriz";
import { exigidosHasta } from "./ndi";
import { describirRegla } from "./reglas";
import { CeldaMatriz, Etapa, LODS, Parametro } from "./types";

export interface DatosMatriz {
  proyecto: string;
  grupos: GrupoMatriz[];
  etapas: Etapa[];
  celdas: Map<string, CeldaMatriz>;
  catalogo: Map<string, Parametro>;
  /** "DD-MM-AAAA" of the issue (today by default; tests fix it). */
  emitida?: string;
}

function hoy(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const VACIA = "#F1F3F5";
const AZUL = "#2F55B0";

async function excelJs() {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
  return (mod.default ?? mod) as typeof import("exceljs");
}

export async function exportarMatrizExcel(datos: DatosMatriz) {
  const buffer = await libroMatriz(datos);
  descargar(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${nombreSeguro(`Matriz LOIN - ${datos.proyecto}`)}.xlsx`);
}

export async function exportarMatrizPdf(datos: DatosMatriz) {
  const pdf = await pdfMatriz(datos);
  descargar(new Blob([pdf], { type: "application/pdf" }), `${nombreSeguro(`Matriz LOIN - ${datos.proyecto}`)}.pdf`);
}

/** The workbook's bytes. */
export async function libroMatriz(datos: DatosMatriz): Promise<ArrayBuffer> {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  const emitida = datos.emitida ?? hoy();
  const { grupos, etapas, celdas, catalogo } = datos;
  const encabezado = (ws: import("exceljs").Worksheet, fila: number) => {
    const row = ws.getRow(fila);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(AZUL) } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  };

  // ---- the colored matrix
  const ws = wb.addWorksheet("Matriz LOIN");
  ws.addRow([`Matriz LOIN · ${datos.proyecto}`]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([`Emitida ${emitida} · LOD: detalle geométrico (convención BIMForum) · NDI: nivel de información, acumulativo (NDI-2 exige los parámetros NDI-1 y NDI-2)`]);
  ws.addRow([]);
  ws.addRow(["Disciplina", "Código", "Elemento", "Clase IFC", ...etapas.map((e) => `${e.nombre}${e.fecha ? `\n${fechaCorta(e.fecha)}` : ""}`)]);
  encabezado(ws, 4);
  ws.getRow(4).height = 32;
  [24, 10, 34, 22, ...etapas.map(() => 18)].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 4 }];
  for (const g of grupos) {
    ws.addRow([`${g.disciplina.codigo} · ${g.disciplina.nombre}`]);
    const r = ws.getRow(ws.rowCount);
    r.font = { bold: true };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
    for (const e of g.elementos) {
      ws.addRow([g.disciplina.codigo, e.codigo, e.nombre, e.claseIfc, ...etapas.map((et) => textoCelda(celdas.get(clave(e.id, et.id))) || "—")]);
      const row = ws.getRow(ws.rowCount);
      etapas.forEach((et, i) => {
        const cell = row.getCell(5 + i);
        const color = colorCelda(celdas.get(clave(e.id, et.id)));
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(color?.fondo ?? VACIA) } };
        cell.font = { bold: !!color, color: { argb: color ? argb(color.texto) : "FF8A929B" } };
        cell.border = { top: { style: "thin", color: { argb: "FFFFFFFF" } }, bottom: { style: "thin", color: { argb: "FFFFFFFF" } }, left: { style: "thin", color: { argb: "FFFFFFFF" } }, right: { style: "thin", color: { argb: "FFFFFFFF" } } };
      });
    }
  }
  ws.addRow([]);
  ws.addRow(["Leyenda"]);
  ws.getRow(ws.rowCount).font = { bold: true };
  const leyenda = (texto: string, fondo: string, color: string, descripcion: string) => {
    ws.addRow([texto, "", descripcion]);
    const c = ws.getRow(ws.rowCount).getCell(1);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fondo) } };
    c.font = { bold: true, color: { argb: argb(color) } };
  };
  for (const l of LODS) leyenda(`LOD ${l}`, COLOR_LOD[l].fondo, COLOR_LOD[l].texto, DESCRIPCION_LOD[l]);
  leyenda("Solo NDI", COLOR_SOLO_NDI.fondo, COLOR_SOLO_NDI.texto, "Se pide información (NDI) pero no un nivel de detalle geométrico.");
  leyenda("—", VACIA, "#8A929B", "No se exige en esa etapa.");
  ws.addRow(["LOD: resumen propio de la convención BIMForum; no reemplaza su especificación."]);

  // ---- one row per cell
  const det = wb.addWorksheet("Detalle por celda");
  det.addRow(["Disciplina", "Código", "Elemento", "Clase IFC", "Etapa", "Fecha", "LOD", "NDI", "Propósito", "Actor responsable", "Nota", "Parámetros obligatorios", "Parámetros opcionales"]);
  encabezado(det, 1);
  [22, 10, 30, 20, 26, 12, 8, 8, 30, 26, 36, 12, 12].forEach((w, i) => (det.getColumn(i + 1).width = w));
  det.views = [{ state: "frozen", ySplit: 1 }];
  for (const g of grupos) {
    for (const e of g.elementos) {
      for (const et of etapas) {
        const c = celdas.get(clave(e.id, et.id));
        if (!exigeAlgo(c)) continue;
        const p = parametrosExigidos(e, c!.ndi, catalogo);
        det.addRow([g.disciplina.nombre, e.codigo, e.nombre, e.claseIfc, et.nombre, fechaCorta(et.fecha), c!.lod ?? "", c!.ndi !== null ? `NDI-${c!.ndi}` : "", c!.propositos.join(", "), c!.actor, c!.nota, p.obligatorios, p.opcionales]);
      }
    }
  }

  // ---- the information each element must carry at each stage
  const inf = wb.addWorksheet("Información exigida");
  inf.addRow(["Disciplina", "Código", "Elemento", "Etapa", "NDI de la etapa", "Código parámetro", "Parámetro", "TDI", "NDI", "Obligatorio", "Regla", "Dónde se lee (equivalencias)"]);
  encabezado(inf, 1);
  [22, 10, 30, 26, 10, 12, 36, 8, 8, 11, 26, 60].forEach((w, i) => (inf.getColumn(i + 1).width = w));
  inf.views = [{ state: "frozen", ySplit: 1 }];
  for (const g of grupos) {
    for (const e of g.elementos) {
      for (const et of etapas) {
        const c = celdas.get(clave(e.id, et.id));
        if (!c || c.ndi === null) continue;
        for (const x of exigidosHasta(e.parametros, catalogo, c.ndi)) {
          inf.addRow([
            g.disciplina.nombre, e.codigo, e.nombre, et.nombre, `NDI-${c.ndi}`, x.parametro.codigo, x.parametro.nombre, `TDI-${x.parametro.tdi}`, `NDI-${x.ndi}`,
            x.obligatorio ? "Sí" : "No", describirRegla(x.regla, x.parametro.unidad) || "No vacío", textoListaAlias(x.parametro.alias),
          ]);
        }
      }
    }
  }

  // ---- stages
  const es = wb.addWorksheet("Etapas");
  es.addRow(["Orden", "Código", "Etapa", "Fecha del hito"]);
  encabezado(es, 1);
  [8, 10, 36, 14].forEach((w, i) => (es.getColumn(i + 1).width = w));
  etapas.forEach((e, i) => es.addRow([i + 1, e.codigo, e.nombre, fechaCorta(e.fecha)]));

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------------------------------------------------------------- PDF

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The colored matrix on landscape pages (A3 when there are many stages), header repeated on each page. */
export async function pdfMatriz(datos: DatosMatriz): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const { grupos, etapas, celdas } = datos;
  const doc = new jsPDF({ unit: "mm", format: etapas.length > 6 ? "a3" : "a4", orientation: "landscape", compress: true });
  const M = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - 2 * M;
  const colElemento = Math.min(85, Math.max(55, usable * 0.3));
  const colEtapa = etapas.length ? (usable - colElemento) / etapas.length : 0;
  const FILA = 6.2;
  const emitida = datos.emitida ?? hoy();
  let y = M;

  const fit = (text: string, width: number): string => {
    const t0 = pdfSafe(text);
    if (doc.getTextWidth(t0) <= width) return t0;
    let t = t0;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  };

  function cabecera() {
    const alto = 13;
    doc.setFillColor(...rgb(AZUL));
    doc.rect(M, y, usable, alto, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Elemento", M + 2, y + 7.5);
    etapas.forEach((et, i) => {
      const x = M + colElemento + i * colEtapa + colEtapa / 2;
      doc.setFont("helvetica", "bold");
      // The stage's name on up to two lines, then its date.
      const lineas = (doc.splitTextToSize(pdfSafe(et.nombre), colEtapa - 2) as string[]).slice(0, 2);
      if (lineas.length === 2 && doc.splitTextToSize(pdfSafe(et.nombre), colEtapa - 2).length > 2) lineas[1] = fit(`${lineas[1]}...`, colEtapa - 2);
      lineas.forEach((l, k) => doc.text(l, x, y + 4 + k * 3.3, { align: "center" }));
      doc.setFont("helvetica", "normal");
      doc.text(fechaCorta(et.fecha) || "sin fecha", x, y + 11, { align: "center" });
    });
    y += alto + 0.8;
  }

  function filaGrupo(texto: string, color: string) {
    doc.setFillColor(246, 248, 251);
    doc.rect(M, y, usable, FILA - 0.6, "F");
    doc.setFillColor(...rgb(color));
    doc.rect(M + 1.5, y + 1.6, 2.6, 2.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(31, 63, 143);
    doc.text(fit(texto, usable - 8), M + 5.5, y + 3.9);
    y += FILA;
  }

  /** A new page when the next row doesn't fit; returns whether it started one. */
  function saltoSiHaceFalta(alto: number): boolean {
    if (y + alto <= pageH - M - 6) return false;
    doc.addPage();
    y = M;
    cabecera();
    return true;
  }

  // Title and legend
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(10, 61, 98);
  doc.text(pdfSafe(`Matriz LOIN · ${datos.proyecto}`), M, y + 5);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 100, 110);
  doc.text(pdfSafe(`Emitida ${emitida} · LOD: detalle geométrico (convención BIMForum) · NDI: nivel de información, acumulativo`), M, y + 3);
  y += 6;
  let x = M;
  doc.setFontSize(7.5);
  const chip = (texto: string, fondo: string, color: string) => {
    const w = doc.getTextWidth(texto) + 5;
    doc.setFillColor(...rgb(fondo));
    doc.roundedRect(x, y, w, 5, 1, 1, "F");
    doc.setTextColor(...rgb(color));
    doc.setFont("helvetica", "bold");
    doc.text(texto, x + 2.5, y + 3.5);
    x += w + 2;
  };
  for (const l of LODS) chip(`LOD ${l}`, COLOR_LOD[l].fondo, COLOR_LOD[l].texto);
  chip("Solo NDI", COLOR_SOLO_NDI.fondo, COLOR_SOLO_NDI.texto);
  chip("- No se exige", VACIA, "#6B7480");
  y += 8;
  cabecera();

  for (const g of grupos) {
    saltoSiHaceFalta(FILA * 2);
    filaGrupo(`${g.disciplina.codigo} · ${g.disciplina.nombre} (${g.elementos.length})`, g.disciplina.color);
    for (const e of g.elementos) {
      // A discipline that goes on to the next page is named again there.
      if (saltoSiHaceFalta(FILA)) filaGrupo(`${g.disciplina.codigo} · ${g.disciplina.nombre} (continúa)`, g.disciplina.color);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      doc.setTextColor(40, 40, 40);
      doc.text(fit(`${e.codigo} · ${e.nombre}${e.claseIfc ? ` (${e.claseIfc})` : ""}`, colElemento - 3), M + 2, y + 3.9);
      etapas.forEach((et, i) => {
        const c = celdas.get(clave(e.id, et.id));
        const color = colorCelda(c);
        const cx = M + colElemento + i * colEtapa;
        // A thin gap of the page's white between cells.
        doc.setFillColor(...rgb(color?.fondo ?? VACIA));
        doc.rect(cx + 0.4, y + 0.3, colEtapa - 0.8, FILA - 0.6, "F");
        doc.setTextColor(...rgb(color?.texto ?? "#8A929B"));
        doc.setFont("helvetica", color ? "bold" : "normal");
        doc.text(fit(textoCelda(c) || "-", colEtapa - 2), cx + colEtapa / 2, y + 3.9, { align: "center" });
      });
      doc.setDrawColor(232, 236, 241);
      doc.line(M, y + FILA, M + colElemento, y + FILA);
      y += FILA;
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 128, 136);
    doc.text(pdfSafe(`Requisitos BIM (LOIN) · ${datos.proyecto}`), M, pageH - 5);
    doc.text(`Página ${p} de ${paginas}`, pageW - M, pageH - 5, { align: "right" });
  }
  return doc.output("arraybuffer");
}
