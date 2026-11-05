// The traceability PDF (phase 5), built in the browser with jsPDF: per file,
// a summary and everything that happened to it in order (who uploaded each
// version and when, who reviewed, decision and date, comments, who copied it
// to the destination and when). Letter, landscape so the details fit.
import { fechaHora } from "../compras/formato";
import { pdfSafe } from "../graficos/pdfReport";
import { describirFiltro, FiltroTraza, resumenTraza, Traza } from "./trazabilidad";

const M = 12;
/** Columns: date, who, what, version, detail (the rest). */
const COLS = [30, 38, 36, 14] as const;

export function nombrePdfTrazabilidad(proyecto: string, generado: string, archivo?: string): string {
  const dia = fechaHora(generado).slice(0, 10);
  const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `Trazabilidad - ${limpio(archivo || proyecto || "proyecto")} - ${dia}.pdf`;
}

export async function pdfTrazabilidad(o: {
  trazas: Traza[];
  filtro: FiltroTraza;
  hitos: Map<string, string>;
  proyecto: string;
  /** When it was made (ISO) and by whom. */
  generado: string;
  por: string;
}): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape", compress: true });
  doc.setCreationDate(new Date(o.generado));
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const xDetalle = M + COLS.reduce((s, c) => s + c, 0);
  const anchoDetalle = ancho - M - xDetalle;
  let y = M;

  const fuente = (size: number, bold = false, color: [number, number, number] = [40, 40, 40]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const encabezado = () => {
    fuente(13, true, [21, 90, 122]);
    doc.text(pdfSafe(`Trazabilidad - Flujo de aprobación`), M, y + 4);
    fuente(9);
    doc.text(pdfSafe(o.proyecto), ancho - M, y + 4, { align: "right" });
    y += 9;
    fuente(8.5, false, [90, 90, 90]);
    doc.text(pdfSafe(`${describirFiltro(o.filtro, o.hitos)} · Generado el ${fechaHora(o.generado)} por ${o.por}`), M, y);
    y += 3;
    doc.setDrawColor(200, 205, 212);
    doc.line(M, y, ancho - M, y);
    y += 5;
  };
  const nuevaPagina = () => {
    doc.addPage();
    y = M;
    encabezado();
  };
  const espacio = (mm: number) => {
    if (y + mm > alto - M - 4) nuevaPagina();
  };
  const cabeceraTabla = () => {
    doc.setFillColor(238, 241, 245);
    doc.rect(M, y - 3.6, ancho - 2 * M, 5.4, "F");
    fuente(8.5, true, [60, 60, 60]);
    let x = M + 1;
    for (const [i, t] of ["Fecha", "Quién", "Qué", "Versión", "Detalle"].entries()) {
      doc.text(t, x, y);
      x += i < COLS.length ? COLS[i] : 0;
    }
    y += 5;
  };

  encabezado();
  if (!o.trazas.length) {
    fuente(10);
    doc.text(pdfSafe("No hay archivos con estos filtros."), M, y + 2);
  }
  for (const [n, t] of o.trazas.entries()) {
    espacio(30);
    if (n > 0) y += 3;
    fuente(11, true, [21, 90, 122]);
    doc.text(pdfSafe(t.archivo.nombre), M, y);
    y += 5;
    for (const r of resumenTraza(t)) {
      fuente(8.5, true, [70, 70, 70]);
      doc.text(pdfSafe(`${r.etiqueta}:`), M, y);
      fuente(8.5);
      const lineas = doc.splitTextToSize(pdfSafe(r.valor), ancho - 2 * M - 32) as string[];
      doc.text(lineas, M + 32, y);
      y += 3.8 * Math.max(1, lineas.length);
    }
    y += 2;
    if (!t.eventos.length) {
      fuente(8.5, false, [110, 110, 110]);
      doc.text(pdfSafe("Sin movimientos en estas fechas."), M, y);
      y += 5;
      continue;
    }
    cabeceraTabla();
    for (const e of t.eventos) {
      fuente(8.5);
      const detalle = doc.splitTextToSize(pdfSafe(e.detalle), anchoDetalle - 1) as string[];
      const quien = doc.splitTextToSize(pdfSafe(e.quien || "—"), COLS[1] - 2) as string[];
      const alturaFila = 3.7 * Math.max(detalle.length, quien.length, 1) + 1.2;
      if (y + alturaFila > alto - M - 4) {
        nuevaPagina();
        fuente(9, true, [21, 90, 122]);
        doc.text(pdfSafe(`${t.archivo.nombre} (continúa)`), M, y);
        y += 5;
        cabeceraTabla();
        fuente(8.5);
      }
      let x = M + 1;
      doc.text(pdfSafe(fechaHora(e.fecha)), x, y);
      x += COLS[0];
      doc.text(quien, x, y);
      x += COLS[1];
      doc.text(pdfSafe(e.que), x, y);
      x += COLS[2];
      doc.text(e.version === null ? "" : String(e.version), x, y);
      doc.text(detalle, xDetalle + 1, y);
      y += alturaFila;
      doc.setDrawColor(232, 236, 241);
      doc.line(M, y - 3.2, ancho - M, y - 3.2);
    }
  }

  // Page numbers.
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    fuente(8, false, [120, 120, 120]);
    doc.text(`Página ${p} de ${paginas}`, ancho - M, alto - 6, { align: "right" });
  }
  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
}
