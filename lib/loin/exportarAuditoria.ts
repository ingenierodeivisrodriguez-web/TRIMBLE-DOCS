// Audit reports (browser; ExcelJS and jsPDF loaded on demand): an Excel book
// with the summary, every object with what it lacks, the most failed
// parameters and the unclassified objects; and a PDF summary with a bar per
// discipline, the elements, the most failed parameters and the reference
// images of the elements with problems. Both come from the same report, live
// (just audited) or saved.
import { pdfSafe } from "../graficos/pdfReport";
import { descargar, nombreSeguro } from "../presupuesto/excel";
import { ESTADOS, estadoDe, MOTIVOS_FALLA } from "./auditoria";
import { fechaCorta } from "./matriz";
import type { EstadoObjeto, InformeAuditoria, MotivoFalla, Totales } from "./types";

async function excelJs() {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
  return (mod.default ?? mod) as typeof import("exceljs");
}

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const AZUL = "#2F55B0";
const MOTIVOS: MotivoFalla[] = ["falta", "modelado", "sin_llenar", "valor"];

function hoy(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** The audit date goes first so two audits of the same stage never share a file name. */
const nombreArchivo = (i: InformeAuditoria, emitida: string, ext: string) =>
  `${nombreSeguro(`Auditoría LOIN ${emitida.split(" ")[0]} - ${i.proyecto} - ${i.etapa.nombre}`, 120)}.${ext}`;
const textoEstado = (e: EstadoObjeto) => `${ESTADOS[e].icono} ${ESTADOS[e].nombre}`;

export async function exportarAuditoriaExcel(informe: InformeAuditoria, emitida = hoy()) {
  const buffer = await libroAuditoria(informe, emitida);
  descargar(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombreArchivo(informe, emitida, "xlsx"));
}

export async function exportarAuditoriaPdf(informe: InformeAuditoria, imagenes: Map<string, string> = new Map(), emitida = hoy()) {
  const pdf = await pdfAuditoria(informe, imagenes, emitida);
  descargar(new Blob([pdf], { type: "application/pdf" }), nombreArchivo(informe, emitida, "pdf"));
}

/** The workbook's bytes. */
export async function libroAuditoria(informe: InformeAuditoria, emitida = hoy()): Promise<ArrayBuffer> {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  const elementos = new Map(informe.elementos.map((e) => [e.id, e]));
  const disciplinas = new Map(informe.disciplinas.map((d) => [d.id, d]));
  const encabezado = (ws: import("exceljs").Worksheet) => {
    const row = ws.getRow(ws.rowCount);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(AZUL) } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  };
  const pintarEstado = (cell: import("exceljs").Cell, estado: EstadoObjeto) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(ESTADOS[estado].color) } };
    cell.font = { bold: true, color: { argb: estado === "parcial" ? "FF0B0B0B" : "FFFFFFFF" } };
  };
  const filaTotales = (t: Totales) => [t.objetos, t.cumple, t.parcial, t.noCumple, t.exigidos, t.cumplidos, t.pct / 100];

  // ---- summary
  const r = wb.addWorksheet("Resumen");
  r.addRow([`Auditoría de requisitos BIM (LOIN) · ${informe.proyecto}`]);
  r.getRow(1).font = { bold: true, size: 14 };
  r.addRow([`Etapa: ${informe.etapa.nombre}${informe.etapa.fecha ? ` (${fechaCorta(informe.etapa.fecha)})` : ""} · Emitida ${emitida}`]);
  r.addRow([`Modelos: ${informe.modelos.map((m) => `${m.nombre}${m.versionId ? ` (versión ${m.versionId})` : ""}`).join(", ")}`]);
  r.addRow([`Cumplimiento = parámetros obligatorios cumplidos ÷ exigidos. Verde: 100 %; amarillo: desde ${informe.umbralAmarillo} %; rojo: por debajo. Las excepciones aceptadas cuentan como cumplidas.`]);
  r.addRow([]);
  r.addRow(["Total", "Objetos", "Cumplen", "Parcial", "No cumplen", "Obligatorios exigidos", "Cumplidos", "% cumplimiento"]);
  encabezado(r);
  r.addRow(["Total", ...filaTotales(informe.total)]);
  r.getRow(r.rowCount).font = { bold: true };
  for (const d of informe.disciplinas) r.addRow([`${d.codigo} · ${d.nombre}`, ...filaTotales(d.totales)]);
  r.addRow([]);
  r.addRow(["Elemento", "Objetos", "Cumplen", "Parcial", "No cumplen", "Obligatorios exigidos", "Cumplidos", "% cumplimiento", "Disciplina", "NDI", "LOD"]);
  encabezado(r);
  for (const e of informe.elementos) {
    const d = disciplinas.get(e.disciplinaId);
    r.addRow([`${e.codigo} · ${e.nombre}`, ...filaTotales(e.totales), d ? d.codigo : "", `NDI-${e.ndi}`, e.lod ?? ""]);
  }
  r.addRow([]);
  r.addRow(["Incumplimientos de obligatorios por motivo"]);
  r.getRow(r.rowCount).font = { bold: true };
  for (const m of MOTIVOS) r.addRow([MOTIVOS_FALLA[m], informe.porMotivo[m]]);
  r.addRow(["Aceptados por excepción", informe.aceptados]);
  r.addRow(["Objetos sin clasificar", informe.sinClasificar]);
  r.addRow(["Objetos de elementos sin exigencia de información en esta etapa", informe.sinExigencia]);
  r.addRow(["Objetos sin IFCGUID", informe.sinGuid]);
  if (informe.elementosSinObjetos.length) r.addRow(["Elementos exigidos sin objetos en los modelos", informe.elementosSinObjetos.join(", ")]);
  r.getColumn(1).width = 48;
  for (let c = 2; c <= 11; c++) r.getColumn(c).width = 14;
  r.getColumn(8).numFmt = "0.0%";

  // ---- every object
  const det = wb.addWorksheet("Detalle por objeto");
  det.addRow(["Disciplina", "Elemento", "IFCGUID", "Objeto", "Modelo", "Estado", "%", "Cumplidos", "Exigidos", "Faltan (obligatorios)", "Opcionales que faltan", "Aceptados"]);
  encabezado(det);
  [16, 30, 26, 32, 22, 16, 8, 10, 10, 60, 40, 30].forEach((w, i) => (det.getColumn(i + 1).width = w));
  det.views = [{ state: "frozen", ySplit: 1 }];
  const describir = (fallas: InformeAuditoria["objetos"][number]["fallas"], filtro: (f: InformeAuditoria["objetos"][number]["fallas"][number]) => boolean) =>
    fallas
      .filter(filtro)
      .map((f) => `${f.codigo} ${informe.parametros[f.codigo] ?? ""} (${MOTIVOS_FALLA[f.motivo].toLowerCase()})`)
      .join("; ");
  for (const o of informe.objetos) {
    const e = elementos.get(o.elementoId);
    const d = e ? disciplinas.get(e.disciplinaId) : undefined;
    det.addRow([
      d?.codigo ?? "",
      e ? `${e.codigo} · ${e.nombre}` : "",
      o.ifcGuid,
      o.nombre,
      o.modelo,
      textoEstado(o.estado),
      o.pct / 100,
      o.cumplidos,
      o.exigidos,
      describir(o.fallas, (f) => f.obligatorio && f.motivo !== "aceptado"),
      describir(o.fallas, (f) => !f.obligatorio && f.motivo !== "aceptado"),
      describir(o.fallas, (f) => f.motivo === "aceptado"),
    ]);
    pintarEstado(det.getRow(det.rowCount).getCell(6), o.estado);
    det.getRow(det.rowCount).getCell(7).numFmt = "0.0%";
  }

  // ---- most failed parameters
  const mi = wb.addWorksheet("Más incumplidos");
  mi.addRow(["Código", "Parámetro", "Incumplimientos", ...MOTIVOS.map((m) => MOTIVOS_FALLA[m])]);
  encabezado(mi);
  [12, 40, 14, 18, 18, 14, 16].forEach((w, i) => (mi.getColumn(i + 1).width = w));
  for (const p of informe.masIncumplidos) mi.addRow([p.codigo, p.nombre, p.fallas, ...MOTIVOS.map((m) => p.porMotivo[m])]);

  // ---- unclassified
  const sc = wb.addWorksheet("Sin clasificar");
  sc.addRow(["IFCGUID", "Objeto", "Clase", "Tipo", "Modelo"]);
  encabezado(sc);
  [26, 34, 24, 34, 24].forEach((w, i) => (sc.getColumn(i + 1).width = w));
  for (const s of informe.objetosSinClasificar) sc.addRow([s.ifcGuid, s.nombre, s.clase, s.tipo, s.modelo]);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------------------------------------------------------------- PDF

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * The summary as a portrait PDF. `imagenes`: a JPEG data URL per element
 * (its first reference image), shown with the elements that fail most.
 */
export async function pdfAuditoria(informe: InformeAuditoria, imagenes: Map<string, string> = new Map(), emitida = hoy()): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const M = 12;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const usable = W - 2 * M;
  let y = M;
  const umbral = informe.umbralAmarillo;
  const disciplinas = new Map(informe.disciplinas.map((d) => [d.id, d]));

  const fit = (text: string, width: number): string => {
    const t0 = pdfSafe(text);
    if (doc.getTextWidth(t0) <= width) return t0;
    let t = t0;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  };
  const salto = (alto: number) => {
    if (y + alto <= H - M - 6) return;
    doc.addPage();
    y = M;
  };
  const titulo = (t: string) => {
    salto(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(31, 63, 143);
    doc.text(pdfSafe(t), M, y + 4);
    y += 7;
  };
  const texto = (t: string, size = 8.5, color: [number, number, number] = [60, 66, 74]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const linea of doc.splitTextToSize(pdfSafe(t), usable) as string[]) {
      salto(4.5);
      doc.text(linea, M, y + 3);
      y += 4.2;
    }
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(10, 61, 98);
  doc.text(pdfSafe(`Auditoría de requisitos BIM · ${informe.proyecto}`), M, y + 5);
  y += 9;
  texto(`Etapa: ${informe.etapa.nombre}${informe.etapa.fecha ? ` (${fechaCorta(informe.etapa.fecha)})` : ""} · Emitida ${emitida}`, 9);
  texto(`Modelos: ${informe.modelos.map((m) => `${m.nombre}${m.versionId ? ` (versión ${m.versionId})` : ""}`).join(", ")}`, 8);
  y += 2;

  // The headline: total % and the status counts, each with its icon word and color.
  const estadoTotal = estadoDe(informe.total.pct, umbral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(20, 24, 30);
  doc.text(`${informe.total.pct.toLocaleString("es")} %`, M, y + 11);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 100, 110);
  doc.text(pdfSafe(`de los parámetros obligatorios cumplidos (${informe.total.cumplidos} de ${informe.total.exigidos}) · ${ESTADOS[estadoTotal].nombre}`), M, y + 16);
  const cajas: [string, number, string][] = [
    [`Cumplen`, informe.total.cumple, ESTADOS.cumple.color],
    [`Parcial`, informe.total.parcial, ESTADOS.parcial.color],
    [`No cumplen`, informe.total.noCumple, ESTADOS.no_cumple.color],
    [`Sin clasificar`, informe.sinClasificar, ESTADOS.sin_clasificar.color],
  ];
  cajas.forEach(([nombre, n, color], i) => {
    const x = M + 70 + i * 28;
    doc.setFillColor(...rgb(color));
    doc.roundedRect(x, y, 26, 15, 1.5, 1.5, "F");
    doc.setTextColor(...(color === ESTADOS.parcial.color ? ([11, 11, 11] as [number, number, number]) : ([255, 255, 255] as [number, number, number])));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(String(n), x + 13, y + 7, { align: "center" });
    doc.setFontSize(7);
    doc.text(nombre, x + 13, y + 12, { align: "center" });
  });
  y += 21;

  // Bars by discipline (the bar's color is its state; the value is written next to it).
  titulo("Cumplimiento por disciplina");
  const anchoEtiqueta = 52;
  const anchoBarra = usable - anchoEtiqueta - 16;
  for (const d of informe.disciplinas) {
    salto(7);
    const e = estadoDe(d.totales.pct, umbral);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    doc.text(fit(`${d.codigo} · ${d.nombre}`, anchoEtiqueta - 2), M, y + 4);
    doc.setFillColor(236, 239, 243);
    doc.rect(M + anchoEtiqueta, y, anchoBarra, 5, "F");
    doc.setFillColor(...rgb(ESTADOS[e].color));
    doc.rect(M + anchoEtiqueta, y, (anchoBarra * Math.min(100, d.totales.pct)) / 100, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.text(`${d.totales.pct} %`, M + anchoEtiqueta + anchoBarra + 2, y + 4);
    y += 7;
  }
  y += 2;

  // Elements
  titulo("Elementos");
  const cols = [70, 18, 18, 18, 18, 0];
  cols[5] = usable - cols.slice(0, 5).reduce((a, b) => a + b, 0);
  const cabecera = ["Elemento", "Objetos", "Cumplen", "Parcial", "No cumplen", "% cumplimiento"];
  const filaTabla = (celdas: string[], negrita = false, fondo?: string) => {
    salto(6);
    if (fondo) {
      doc.setFillColor(...rgb(fondo));
      doc.rect(M, y, usable, 5.6, "F");
    }
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(fondo === AZUL ? ([255, 255, 255] as [number, number, number]) : ([40, 40, 40] as [number, number, number])));
    let x = M;
    celdas.forEach((c, i) => {
      doc.text(fit(c, cols[i] - 2), x + 1, y + 4);
      x += cols[i];
    });
    y += 5.8;
  };
  filaTabla(cabecera, true, AZUL);
  for (const e of [...informe.elementos].sort((a, b) => a.totales.pct - b.totales.pct)) {
    const d = disciplinas.get(e.disciplinaId);
    const t = e.totales;
    filaTabla([`${d ? `${d.codigo} · ` : ""}${e.codigo} · ${e.nombre}`, String(t.objetos), String(t.cumple), String(t.parcial), String(t.noCumple), t.objetos ? `${t.pct} %` : "sin objetos"]);
  }
  y += 2;

  // Most failed parameters and the reasons
  if (informe.masIncumplidos.length) {
    titulo("Parámetros más incumplidos");
    for (const p of informe.masIncumplidos.slice(0, 10)) {
      const motivos = MOTIVOS.filter((m) => p.porMotivo[m] > 0)
        .map((m) => `${MOTIVOS_FALLA[m].toLowerCase()} ${p.porMotivo[m]}`)
        .join(", ");
      texto(`${p.codigo} ${p.nombre}: ${p.fallas} objeto(s) — ${motivos}`);
    }
    y += 2;
  }
  texto(
    `Motivos de los incumplimientos obligatorios: ${MOTIVOS.map((m) => `${MOTIVOS_FALLA[m].toLowerCase()} ${informe.porMotivo[m]}`).join(" · ")}. Aceptados por excepción: ${informe.aceptados}. ` +
      `"Problema de modelado" es un dato automático (geometría o software) que el objeto no trae.`,
    7.5
  );
  if (informe.elementosSinObjetos.length) texto(`Elementos exigidos sin objetos en los modelos: ${informe.elementosSinObjetos.join(", ")}.`, 7.5);

  // The elements that fail most, with their reference image.
  const conProblemas = informe.elementos.filter((e) => e.totales.objetos > 0 && e.totales.pct < 100).sort((a, b) => a.totales.pct - b.totales.pct).slice(0, 8);
  if (conProblemas.length) {
    y += 2;
    titulo("Elementos a corregir");
    for (const e of conProblemas) {
      salto(30);
      const img = imagenes.get(e.id);
      let x = M;
      if (img) {
        try {
          doc.addImage(img, "JPEG", M, y, 36, 26);
          x = M + 40;
        } catch {
          // an image that can't be drawn is left out
        }
      }
      const fallas = new Map<string, number>();
      for (const o of informe.objetos) {
        if (o.elementoId !== e.id) continue;
        for (const f of o.fallas) if (f.obligatorio && f.motivo !== "aceptado") fallas.set(f.codigo, (fallas.get(f.codigo) ?? 0) + 1);
      }
      const top = [...fallas].sort((a, b) => b[1] - a[1]).slice(0, 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(31, 63, 143);
      doc.text(fit(`${e.codigo} · ${e.nombre} — ${e.totales.pct} %`, W - M - x), x, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60, 66, 74);
      top.forEach(([codigo, n], k) => doc.text(fit(`${codigo} ${informe.parametros[codigo] ?? ""}: falta en ${n} objeto(s)`, W - M - x), x, y + 9 + k * 4.2));
      y += img ? 29 : Math.max(10, 9 + top.length * 4.2);
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 128, 136);
    doc.text(pdfSafe(`Requisitos BIM (LOIN) · ${informe.proyecto} · ${informe.etapa.nombre}`), M, H - 5);
    doc.text(`Página ${p} de ${paginas}`, W - M, H - 5, { align: "right" });
  }
  return doc.output("arraybuffer");
}

/** The first reference image of each element as a small JPEG data URL (browser only; images that fail are skipped). */
export async function imagenesParaPdf(urls: Map<string, string>, lado = 480): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [elementoId, url] of urls) {
    try {
      const blob = await (await fetch(url)).blob();
      const bitmap = await createImageBitmap(blob);
      const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * escala);
      canvas.height = Math.round(bitmap.height * escala);
      const g = canvas.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      out.set(elementoId, canvas.toDataURL("image/jpeg", 0.8));
    } catch {
      // without it the element is shown without its image
    }
  }
  return out;
}
