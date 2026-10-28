// The printable sheet of a QR point (browser and tests; jsPDF and qrcode loaded on demand):
// the QR, a cross that goes on the point marked on the floor and an arrow that
// must point to the written reference. The phone (phase 3) takes both from it.
import { pdfSafe } from "../graficos/pdfReport";
import type { Vec3 } from "./modelo";

export interface DatosHoja {
  nombre: string;
  referencia: string;
  url: string;
  codigo: string;
  /** "DD-MM-AAAA". */
  vence: string;
  proyecto: string;
  modelo: string;
  elemento: string;
  /** IFC coordinates of the point, metres. */
  coordenadas: Vec3;
}

export const nombreHoja = (d: { nombre: string }) => `QR ${d.nombre.replace(/[\/:*?"<>|]/g, "-")}.pdf`;

const m2 = (x: number) => x.toFixed(3);

export async function hojaPdf(d: DatosHoja): Promise<Blob> {
  const [{ jsPDF }, QR] = await Promise.all([import("jspdf"), import("qrcode")]);
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  const ancho = doc.internal.pageSize.getWidth();
  const cx = ancho / 2;
  const texto = (t: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "center" | "right"; max?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 10);
    doc.setTextColor(...(o.color ?? [40, 40, 40]));
    const lineas = o.max ? (doc.splitTextToSize(pdfSafe(t), o.max) as string[]) : pdfSafe(t);
    doc.text(lineas, x, y, { align: o.align ?? "left" });
    return Array.isArray(lineas) ? lineas.length : 1;
  };

  texto("PUNTO DE REALIDAD AUMENTADA", cx, 16, { size: 11, bold: true, color: [47, 85, 176], align: "center" });
  texto(d.nombre, cx, 25, { size: 20, bold: true, align: "center", max: ancho - 30 });
  texto(`${d.proyecto} · Modelo: ${d.modelo}`, cx, 32, { size: 9.5, color: [90, 100, 110], align: "center", max: ancho - 30 });

  // QR, error correction M: still reads with some dirt or a fold.
  const imagen = await QR.toDataURL(d.url, { errorCorrectionLevel: "M", margin: 2, scale: 10 });
  const lado = 78;
  doc.addImage(imagen, "PNG", cx - lado / 2, 38, lado, lado);
  texto("Escanee con la cámara de un celular Android (Google Chrome)", cx, 121, { size: 9.5, align: "center" });

  // Arrow from the cross up the sheet.
  doc.setDrawColor(255, 90, 31);
  doc.setFillColor(255, 90, 31);
  doc.setLineWidth(2.2);
  const yCruz = 212;
  const yPunta = 132;
  doc.line(cx, yCruz - 10, cx, yPunta + 9);
  doc.triangle(cx - 7, yPunta + 11, cx + 7, yPunta + 11, cx, yPunta, "F");
  texto("FLECHA", cx + 10, yPunta + 6, { size: 11, bold: true, color: [255, 90, 31] });
  texto(`Debe apuntar: ${d.referencia}`, cx + 10, yPunta + 12, { size: 10, max: ancho / 2 - 20 });

  // Cross on the point.
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.8);
  doc.circle(cx, yCruz, 7, "S");
  doc.line(cx - 16, yCruz, cx + 16, yCruz);
  doc.line(cx, yCruz - 16, cx, yCruz + 16);
  texto("PUNTO", cx - 22, yCruz - 3, { size: 11, bold: true, align: "right" });
  texto("La cruz va exactamente", cx - 22, yCruz + 3, { size: 9, align: "right" });
  texto("sobre la marca del piso", cx - 22, yCruz + 7.5, { size: 9, align: "right" });

  let y = 236;
  texto("Cómo pegar esta hoja", 18, y, { size: 10.5, bold: true });
  y += 5.5;
  const pasos = [
    `Marque en el piso el punto de coordenadas del modelo X = ${m2(d.coordenadas[0])} m, Y = ${m2(d.coordenadas[1])} m, Z = ${m2(d.coordenadas[2])} m${d.elemento ? ` (sobre: ${d.elemento})` : ""}.`,
    `Ponga la hoja en el piso con la cruz sobre la marca y gírela hasta que la flecha apunte ${d.referencia}.`,
    "Fíjela con cinta y no la mueva: el modelo se ubica con ella.",
  ];
  pasos.forEach((p, i) => {
    y += 4.6 * texto(`${i + 1}. ${p}`, 18, y, { size: 9, max: ancho - 36 });
  });
  texto(`Vence el ${d.vence} · Código ${d.codigo}`, cx, 272, { size: 8, color: [120, 120, 120], align: "center" });
  return doc.output("blob");
}
