// The PDF of a purchase order or contract, built in the browser with jsPDF.
// It is reproducible (fixed date and id from the order itself), so a retry of
// its upload produces the very same file and fingerprint.
import { pdfSafe } from "../graficos/pdfReport";
import { fmt } from "../presupuesto/format";
import { totalesCotizacion, totalesLinea } from "./cotizaciones";
import { fecha } from "./formato";
import { numeroOrden } from "./ordenes";
import { nitConDv } from "./proveedores";
import { numeroRequisicion } from "./requisiciones";
import type { Orden, Proveedor, Requisicion } from "./types";

const M = 14;

export function nombrePdfOrden(o: Orden): string {
  return `${numeroOrden(o.tipo, o.numero)}${o.revision ? ` rev ${o.revision}` : ""}.pdf`;
}

export async function pdfOrden(o: Orden, proveedor: Proveedor | undefined, requisicion: Requisicion | undefined, proyecto: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  // Same order, same file.
  doc.setCreationDate(new Date(o.aprobada ?? o.actualizado ?? o.creada));
  doc.setFileId(o.id.replace(/-/g, "").padEnd(32, "0").slice(0, 32).toUpperCase());
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
  const salto = (alto2: number) => {
    if (y + alto2 > alto - M) {
      doc.addPage();
      y = M;
    }
  };

  texto(o.tipo === "contrato" ? "CONTRATO" : "ORDEN DE COMPRA", M, { size: 15, bold: true, color: [10, 61, 98] });
  texto(`${numeroOrden(o.tipo, o.numero)}${o.revision ? ` - revisión ${o.revision}` : ""}`, ancho - M, { size: 13, bold: true, color: [10, 61, 98], align: "right" });
  y += 6;
  texto(proyecto, M, { size: 10, color: [90, 100, 110] });
  texto(o.aprobada ? `Emitida el ${fecha(o.aprobada.slice(0, 10))}` : "Sin emitir (borrador)", ancho - M, { size: 9, color: [90, 100, 110], align: "right" });
  y += 9;

  parrafo("Proveedor", proveedor ? `${proveedor.razonSocial} - NIT ${nitConDv(proveedor.nit, proveedor.dv)}` : "");
  parrafo("Contacto", proveedor ? [proveedor.contacto, proveedor.telefono, proveedor.correo, proveedor.ciudad].filter(Boolean).join(" · ") : "");
  parrafo("Requisición", requisicion ? `${numeroRequisicion(requisicion.numero)} - ${requisicion.justificacion}` : "");
  parrafo(o.tipo === "contrato" ? "Terminación" : "Entrega", `${fecha(o.fechaEntrega)}${o.lugarEntrega ? `, ${o.lugarEntrega}` : ""}`);
  parrafo("Pago", `${o.formaPago || (o.diasPago ? `${o.diasPago} días` : "Contado")}${o.anticipoPct ? ` · anticipo ${fmt(o.anticipoPct)} %` : ""}`);
  if (o.tipo === "contrato") {
    parrafo("Objeto", o.objeto);
    parrafo("Pólizas", o.polizas);
    parrafo("Retención", o.retencionGarantiaPct ? `${fmt(o.retencionGarantiaPct)} % de garantía` : "");
  }
  parrafo("Observaciones", o.observaciones);
  y += 3;

  // Lines.
  const cols: { t: string; w: number; d?: "r" }[] = [
    { t: "Código", w: 20 },
    { t: "Descripción", w: 66 },
    { t: "Und", w: 12 },
    { t: "Cantidad", w: 22, d: "r" },
    { t: "Precio unit.", w: 24, d: "r" },
    { t: "Desc. %", w: 13, d: "r" },
    { t: "IVA %", w: 12, d: "r" },
    { t: "Total", w: 28, d: "r" },
  ];
  const escala = (ancho - 2 * M) / cols.reduce((s, c) => s + c.w, 0);
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w * escala), M);
  const fila = (valores: string[], negrita = false) => {
    salto(6);
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
  for (const l of o.lineas) {
    fila([l.codigo, l.descripcion, l.unidad, fmt(l.cantidad, 4), fmt(l.precioUnitario), fmt(l.descuentoPct), fmt(l.ivaPct), fmt(totalesLinea(l).total)]);
  }
  const t = totalesCotizacion(o);
  y += 2;
  for (const [etiqueta, valor] of [
    ["Subtotal", t.neto],
    ["IVA", t.iva],
    ["Total", t.total],
  ] as const) {
    salto(6);
    texto(etiqueta, ancho - M - 45, { bold: etiqueta === "Total" });
    texto(fmt(valor), ancho - M, { bold: etiqueta === "Total", align: "right" });
    y += 5;
  }
  y += 6;
  salto(14);
  texto(`Elaboró: ${o.elaboradoPor}`, M, { size: 8.5 });
  texto(o.aprobadaPor ? `Aprobó: ${o.aprobadaPor}` : "", ancho / 2, { size: 8.5 });
  y = alto - 8;
  texto("Generado con Compras y Contratación (Trimble Connect). Respaldado en el CDE del proyecto.", ancho / 2, { size: 7, color: [130, 130, 130], align: "center" });
  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
}
