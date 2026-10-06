// Printable tables (budget, list of resources, general expenses) as PDF,
// built in the browser with jsPDF (loaded on demand).
import { pdfSafe } from "../graficos/pdfReport";
import { descargar, nombreSeguro, Tabla } from "./excel";
import { fmt } from "./format";

const MARGIN = 10;
const ROW_H = 5.6;
const FONT = 7.8;

export async function exportarPdf(tabla: Tabla, proyecto: string, nombre: string) {
  const pdf = await pdfTabla(tabla, proyecto);
  descargar(new Blob([pdf], { type: "application/pdf" }), `${nombreSeguro(nombre)}.pdf`);
}

/** The table as a PDF document (A4, landscape when it has many columns). */
export async function pdfTabla(tabla: Tabla, proyecto: string): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: tabla.columnas.length > 6 ? "landscape" : "portrait", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usable = pageW - 2 * MARGIN;
  const total = tabla.columnas.reduce((sum, c) => sum + c.width, 0);
  const widths = tabla.columnas.map((c) => (c.width / total) * usable);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const fecha = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const emitido = `${pad(fecha.getDate())}-${pad(fecha.getMonth() + 1)}-${fecha.getFullYear()}`;
  let y = MARGIN;

  function header() {
    doc.setFillColor(47, 85, 176);
    doc.rect(MARGIN, y, usable, ROW_H + 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT);
    doc.setTextColor(255, 255, 255);
    tabla.columnas.forEach((c, i) => {
      const text = fit(pdfSafe(c.header), widths[i] - 2);
      doc.text(text, xs[i] + widths[i] / 2, y + ROW_H * 0.72, { align: "center" });
    });
    y += ROW_H + 1;
    doc.setTextColor(40, 40, 40);
  }

  function fit(text: string, width: number): string {
    if (doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  }

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(10, 61, 98);
  doc.text(pdfSafe(tabla.titulo), MARGIN, y + 5);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 110);
  doc.text(pdfSafe(`${proyecto}${tabla.subtitulo ? ` · ${tabla.subtitulo}` : ""} · ${emitido}`), MARGIN, y + 3);
  y += 7;
  header();

  for (const fila of tabla.filas) {
    if (y + ROW_H > pageH - MARGIN - 6) {
      doc.addPage();
      y = MARGIN;
      header();
    }
    doc.setFont("helvetica", fila.negrita ? "bold" : "normal");
    doc.setFontSize(FONT);
    tabla.columnas.forEach((c, i) => {
      const v = fila.celdas[i];
      if (v === null || v === undefined || v === "") return;
      const isNum = typeof v === "number";
      const text = isNum ? fmt(v, c.decimales ?? 2) : pdfSafe(String(v));
      const indent = i === 1 && fila.nivel ? fila.nivel * 2.5 : 0;
      const align = c.align ?? (isNum ? "right" : "left");
      const w = widths[i] - 2 - indent;
      const x = align === "right" ? xs[i] + widths[i] - 1 : align === "center" ? xs[i] + widths[i] / 2 : xs[i] + 1 + indent;
      doc.text(fit(text, w), x, y + ROW_H * 0.72, { align });
    });
    doc.setDrawColor(225, 229, 235);
    doc.line(MARGIN, y + ROW_H, MARGIN + usable, y + ROW_H);
    y += ROW_H;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 130, 140);
    doc.text(`Página ${p} de ${pages}`, pageW - MARGIN, pageH - 5, { align: "right" });
  }
  return doc.output("arraybuffer");
}
