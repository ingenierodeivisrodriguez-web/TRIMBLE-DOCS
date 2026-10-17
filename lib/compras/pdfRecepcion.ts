// The reception record (acta de recepción) as a PDF, built in the browser with
// jsPDF. Reproducible like the order's: fixed date and id from the reception.
import { pdfSafe } from "../graficos/pdfReport";
import { fmt } from "../presupuesto/format";
import { fecha, fechaHora } from "./formato";
import { numeroOrden } from "./ordenes";
import { numeroRecepcion } from "./recepciones";
import type { OrdenPorRecibir, Recepcion } from "./types";

const M = 14;

export function nombrePdfRecepcion(r: Recepcion): string {
  return `Acta ${numeroRecepcion(r.numero)}.pdf`;
}

export async function pdfRecepcion(r: Recepcion, orden: OrdenPorRecibir | undefined, proyecto: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  doc.setCreationDate(new Date(r.aprobada ?? r.actualizado ?? r.creada));
  doc.setFileId(r.id.replace(/-/g, "").padEnd(32, "0").slice(0, 32).toUpperCase());
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  let y = M;
  const texto = (t: string, x: number, opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 9);
    doc.setTextColor(...(opts.color ?? [40, 40, 40]));
    doc.text(pdfSafe(t), x, y, { align: opts.align ?? "left" });
  };
  const parrafo = (etiqueta: string, valor: string) => {
    if (!valor) return;
    texto(etiqueta, M, { bold: true });
    const lineas = doc.splitTextToSize(pdfSafe(valor), ancho - 2 * M - 42) as string[];
    doc.setFont("helvetica", "normal");
    doc.text(lineas, M + 42, y);
    y += 4.6 * Math.max(1, lineas.length);
  };

  texto("ACTA DE RECEPCIÓN EN OBRA", M, { size: 15, bold: true, color: [10, 61, 98] });
  texto(numeroRecepcion(r.numero), ancho - M, { size: 13, bold: true, color: [10, 61, 98], align: "right" });
  y += 6;
  texto(proyecto, M, { size: 10, color: [90, 100, 110] });
  texto(r.aprobada ? `Aprobada el ${fechaHora(r.aprobada)}` : "Sin aprobar (borrador)", ancho - M, { size: 9, color: [90, 100, 110], align: "right" });
  y += 9;
  parrafo("Orden / contrato", orden ? `${numeroOrden(orden.tipo, orden.numero)}${orden.revision ? ` (revisión ${orden.revision})` : ""}` : "");
  parrafo("Proveedor", orden ? `${orden.proveedor} - NIT ${orden.nit}` : "");
  parrafo("Fecha de recibo", fecha(r.fecha));
  parrafo("Remisión", r.remision);
  parrafo("Lugar", orden?.lugarEntrega ?? "");
  parrafo("Observaciones", r.observaciones);
  y += 3;

  const cols: { t: string; w: number; d?: "r" }[] = [
    { t: "Código", w: 18 },
    { t: "Descripción", w: 60 },
    { t: "Und", w: 11 },
    { t: "Ordenado", w: 20, d: "r" },
    { t: "Recibido", w: 20, d: "r" },
    { t: "Aceptado", w: 20, d: "r" },
    { t: "Rechazado", w: 20, d: "r" },
    { t: "Devuelto", w: 18, d: "r" },
  ];
  const escala = (ancho - 2 * M) / cols.reduce((s, c) => s + c.w, 0);
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w * escala), M);
  const fila = (valores: string[], negrita = false) => {
    if (y + 6 > alto - M - 20) {
      doc.addPage();
      y = M;
    }
    valores.forEach((v, i) => {
      const c = cols[i];
      const w = c.w * escala;
      let t = pdfSafe(v);
      doc.setFont("helvetica", negrita ? "bold" : "normal");
      doc.setFontSize(8);
      while (t.length > 1 && doc.getTextWidth(t) > w - 2) t = t.slice(0, -1);
      doc.text(t, c.d === "r" ? xs[i] + w - 1 : xs[i] + 1, y, { align: c.d === "r" ? "right" : "left" });
    });
    y += 5.2;
  };
  doc.setFillColor(47, 85, 176);
  doc.rect(M, y - 4, ancho - 2 * M, 6, "F");
  doc.setTextColor(255, 255, 255);
  fila(cols.map((c) => c.t), true);
  doc.setTextColor(40, 40, 40);
  for (const l of r.lineas) {
    const ordenado = orden?.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId)?.ordenado;
    fila([l.codigo, l.descripcion, l.unidad, ordenado === undefined ? "" : fmt(ordenado, 4), fmt(l.recibido, 4), fmt(l.aceptado, 4), fmt(l.rechazado, 4), fmt(l.devuelto, 4)]);
  }
  const rechazos = r.lineas.filter((l) => l.rechazado > 0);
  if (rechazos.length) {
    y += 3;
    texto("Motivos del rechazo", M, { bold: true });
    y += 5;
    for (const l of rechazos) {
      const lineas = doc.splitTextToSize(pdfSafe(`${l.descripcion}: ${l.motivo}`), ancho - 2 * M) as string[];
      doc.setFont("helvetica", "normal");
      doc.text(lineas, M, y);
      y += 4.4 * lineas.length;
    }
  }
  y = Math.max(y + 16, alto - M - 18);
  doc.setDrawColor(120, 120, 120);
  doc.line(M, y, M + 70, y);
  doc.line(ancho / 2 + 10, y, ancho / 2 + 80, y);
  y += 4;
  texto(`Recibió: ${r.elaboradoPor}`, M, { size: 8.5 });
  texto(r.aprobadaPor ? `Aprobó: ${r.aprobadaPor}` : "Aprobó:", ancho / 2 + 10, { size: 8.5 });
  y = alto - 8;
  texto("Generado con Compras y Contratación (Trimble Connect). Respaldado en el CDE del proyecto.", ancho / 2, { size: 7, color: [130, 130, 130], align: "center" });
  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
}
