// The printable sheet of a QR point (browser and tests; jsPDF and qrcode loaded on demand):
// the QR and, under it, the cross that goes on the point marked on the wall.
// The sheet is stuck upright on a wall or column; the phone (phase 3) takes the
// point from the cross and the direction from the wall itself.
import { pdfSafe } from "../graficos/pdfReport";
import type { Vec3 } from "./modelo";

export interface DatosHoja {
  nombre: string;
  /** Where the sheet is stuck ("muro del eje 3 entre B y C, cara hacia el patio"). */
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

export const nombreHoja = (d: { nombre: string }) => `QR ${d.nombre.replace(/[\\/:*?"<>|]/g, "-")}.pdf`;

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
  const lado = 90;
  doc.addImage(imagen, "PNG", cx - lado / 2, 38, lado, lado);
  texto("Escanee con la cámara de un celular Android (Google Chrome)", cx, 133, { size: 9.5, align: "center" });

  // Cross on the point, in orange so the phone and the eye find it.
  const yCruz = 170;
  doc.setDrawColor(255, 90, 31);
  doc.setLineWidth(1.2);
  doc.circle(cx, yCruz, 8, "S");
  doc.line(cx - 20, yCruz, cx + 20, yCruz);
  doc.line(cx, yCruz - 20, cx, yCruz + 20);
  texto("PUNTO", cx - 26, yCruz - 3, { size: 12, bold: true, color: [255, 90, 31], align: "right" });
  texto("La cruz va exactamente", cx - 26, yCruz + 3, { size: 9, align: "right" });
  texto("sobre la marca del muro", cx - 26, yCruz + 7.5, { size: 9, align: "right" });
  texto("ESTE LADO ARRIBA", cx + 26, yCruz - 3, { size: 9, bold: true });
  texto("La hoja va derecha,", cx + 26, yCruz + 3, { size: 9 });
  texto("como se lee", cx + 26, yCruz + 7.5, { size: 9 });

  let y = 206;
  texto("Cómo pegar esta hoja", 18, y, { size: 10.5, bold: true });
  y += 5.5;
  const pasos = [
    `Dónde: ${d.referencia}.`,
    `Marque en ese muro el punto de coordenadas del modelo X = ${m2(d.coordenadas[0])} m, Y = ${m2(d.coordenadas[1])} m, a la altura Z = ${m2(d.coordenadas[2])} m${d.elemento ? ` (sobre: ${d.elemento})` : ""}.`,
    "Pegue la hoja plana y derecha, con la cruz exactamente sobre la marca.",
    "Fíjela por las cuatro esquinas y no la mueva: el modelo se ubica con ella.",
  ];
  pasos.forEach((p, i) => {
    y += 4.6 * texto(`${i + 1}. ${p}`, 18, y, { size: 9.5, max: ancho - 36 }) + 1;
  });
  texto(`Vence el ${d.vence} · Código ${d.codigo}`, cx, 272, { size: 8, color: [120, 120, 120], align: "center" });
  return doc.output("blob");
}
