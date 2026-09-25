// Builds the executive "Exportar PDF" report in the browser. jsPDF is loaded
// on demand, so it only costs anything when a report is actually generated.
import { ChartReportData, chartInsights, ReportTable, reportTable } from "./insights";
import { formatNumber } from "./modelData";
import type { ReportSettings } from "./reportSettings";

export interface RasterImage {
  dataUrl: string;
  width: number;
  height: number;
  format: "PNG" | "JPEG";
}

export interface ReportChart extends ChartReportData {
  /** Color key drawn under the pictures when the table rows can't carry it (A vs B). */
  legend?: { color: string; label: string }[];
  chartImage: RasterImage | null;
  modelImage: RasterImage | null;
}

export interface ReportInput {
  settings: ReportSettings;
  projectName: string;
  generatedAt: Date;
  models: { name: string; objects: number }[];
  filters: string[];
  /** Objects left after the slicers, and before them. */
  analyzedObjects: number;
  totalObjects: number;
  /** The model as the user sees it (own colors), for the cover. */
  coverImage: RasterImage | null;
  charts: ReportChart[];
}

/**
 * jsPDF's built-in fonts only cover Latin-1 (enough for Spanish, ², ³ and ·).
 * Anything else is swapped for a close equivalent so it never prints as garbage.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[−–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\u0000-ÿ]/g, "");
}

const IMAGE_TIMEOUT_MS = 10000;

/**
 * Loads an image from a URL. Uses onload rather than img.decode(), which
 * browsers may hold back while the page is hidden - and never waits forever.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("La imagen tardó demasiado en cargar.")), IMAGE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = src;
  });
}

/** Rasterizes a chart's SVG (as currently drawn on screen) onto a white PNG. */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<RasterImage> {
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("font-family", "Segoe UI, Arial, Helvetica, sans-serif");
  clone.removeAttribute("style");
  // CSS variables don't resolve once the SVG is detached from the page.
  const xml = new XMLSerializer().serializeToString(clone).replace(/var\(--[\w-]+\)/g, "#ffffff");

  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, format: "PNG" };
}

/**
 * Re-encodes the viewer's snapshot as JPEG: a rendered 3D view compresses far
 * better that way than as PNG, which keeps the report light.
 */
export async function snapshotToJpeg(dataUrl: string, quality = 0.85): Promise<RasterImage> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: canvas.width, height: canvas.height, format: "JPEG" };
}

const LOGO_MAX = { width: 600, height: 240 };

/** Reads an uploaded logo and scales it down (keeping transparency) so it can be stored and embedded cheaply. */
export async function prepareLogo(file: File): Promise<RasterImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo del logo."));
    reader.readAsDataURL(file);
  });
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, LOGO_MAX.width / img.naturalWidth, LOGO_MAX.height / img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, format: "PNG" };
}

// ------------------------------------------------------------------ layout

const PAGE_W = 210;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_TOP = 24;
const CONTENT_BOTTOM = 278;

const NAVY = "#0a3d62";
const BLUE = "#1373c2";
const SKY = "#eaf4fc";
const INK = "#2b3440";
const MUTED = "#6b7684";
const RULE = "#d7dee6";
const ZEBRA = "#f5f8fb";
const WHITE = "#ffffff";

const MAX_TABLE_ROWS = 40;
const LINE = 0.44; // line height in mm per font point

function fit(img: RasterImage, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = img.height / img.width;
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  return { w, h };
}

export async function buildReportPdf(input: ReportInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const { settings } = input;
  const reportTitle = settings.title.trim() || "Informe ejecutivo";
  const issuedOn = input.generatedAt.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  let y = CONTENT_TOP;

  // ---------------------------------------------------------------- helpers

  function font(size: number, color: string, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
  }

  function lines(text: string, width: number): string[] {
    return doc.splitTextToSize(pdfSafe(text), width) as string[];
  }

  function newPage() {
    doc.addPage();
    y = CONTENT_TOP;
  }

  function ensureSpace(height: number) {
    if (y + height > CONTENT_BOTTOM) newPage();
  }

  function paragraph(text: string, size: number, color: string, bold = false, gapAfter = 2, x = MARGIN, width = CONTENT_W) {
    font(size, color, bold);
    const wrapped = lines(text, width);
    const height = wrapped.length * size * LINE;
    ensureSpace(height);
    doc.text(wrapped, x, y + size * LINE * 0.78);
    y += height + gapAfter;
  }

  function sectionTitle(text: string) {
    ensureSpace(16);
    font(17, NAVY, true);
    doc.text(pdfSafe(text), MARGIN, y + 6);
    doc.setFillColor(BLUE);
    doc.rect(MARGIN, y + 9, 16, 1.1, "F");
    y += 15;
  }

  function subTitle(text: string) {
    ensureSpace(10);
    font(11.5, NAVY, true);
    doc.text(pdfSafe(text), MARGIN, y + 4.5);
    y += 8;
  }

  function bulletList(items: string[], size = 9.5, x = MARGIN, width = CONTENT_W) {
    for (const item of items) {
      font(size, INK);
      const wrapped = lines(item, width - 5);
      const height = wrapped.length * size * LINE;
      ensureSpace(height + 1.5);
      doc.setFillColor(BLUE);
      doc.rect(x + 0.6, y + size * LINE * 0.42, 1.6, 1.6, "F");
      doc.text(wrapped, x + 5, y + size * LINE * 0.78);
      y += height + 1.5;
    }
  }

  function kpiTiles(tiles: { value: string; label: string; sub: string }[]) {
    const gap = 4;
    const w = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
    const h = 27;
    ensureSpace(h + 4);
    tiles.forEach((tile, i) => {
      const x = MARGIN + i * (w + gap);
      doc.setFillColor(SKY);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
      doc.setFillColor(BLUE);
      doc.rect(x, y, 1.3, h, "F");
      font(17, NAVY, true);
      doc.text(pdfSafe(tile.value), x + 5, y + 11);
      font(8.5, INK, true);
      doc.text(lines(tile.label, w - 8)[0] ?? "", x + 5, y + 17.5);
      font(7.5, MUTED);
      doc.text(lines(tile.sub, w - 8)[0] ?? "", x + 5, y + 22.5);
    });
    y += h + 6;
  }

  function callout(title: string, items: string[]) {
    const size = 9.5;
    font(size, INK);
    const wrapped = items.map((item) => lines(item, CONTENT_W - 16));
    const height = 9 + wrapped.reduce((sum, l) => sum + l.length * size * LINE + 1.5, 0) + 2;
    ensureSpace(height + 4);
    doc.setFillColor(SKY);
    doc.roundedRect(MARGIN, y, CONTENT_W, height, 1.5, 1.5, "F");
    doc.setFillColor(BLUE);
    doc.rect(MARGIN, y, 1.5, height, "F");
    font(9.5, NAVY, true);
    doc.text(pdfSafe(title), MARGIN + 6, y + 6);
    let ly = y + 9.5;
    wrapped.forEach((l) => {
      doc.setFillColor(BLUE);
      doc.rect(MARGIN + 6.4, ly + size * LINE * 0.42, 1.5, 1.5, "F");
      font(size, INK);
      doc.text(l, MARGIN + 10.5, ly + size * LINE * 0.78);
      ly += l.length * size * LINE + 1.5;
    });
    y += height + 5;
  }

  /** Draws an image fitted and centered in a framed box, with a caption under it. */
  function framedImage(img: RasterImage, x: number, top: number, w: number, h: number, caption: string) {
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.3);
    doc.setFillColor(WHITE);
    doc.roundedRect(x, top, w, h, 1.2, 1.2, "FD");
    const size = fit(img, w - 4, h - 4);
    doc.addImage(img.dataUrl, img.format, x + (w - size.w) / 2, top + (h - size.h) / 2, size.w, size.h, undefined, "FAST");
    font(8, MUTED);
    doc.text(pdfSafe(caption), x + w / 2, top + h + 4.2, { align: "center" });
  }

  function legend(items: { color: string; label: string }[]) {
    ensureSpace(7);
    font(8.5, INK);
    let x = MARGIN;
    for (const item of items) {
      const label = pdfSafe(item.label);
      doc.setFillColor(item.color);
      doc.rect(x, y + 0.8, 3, 3, "F");
      doc.text(label, x + 4.5, y + 3.4);
      x += 4.5 + doc.getTextWidth(label) + 8;
    }
    y += 7;
  }

  function table(t: ReportTable) {
    const numberCols = t.columns.length - 1;
    const numberWidth = numberCols >= 4 ? 25 : 30;
    const widths = [CONTENT_W - numberWidth * numberCols, ...t.columns.slice(1).map(() => numberWidth)];
    const rowH = 6.2;

    function row(cells: string[], opts: { header?: boolean; total?: boolean; fill?: string; color?: string }) {
      if (opts.fill) {
        doc.setFillColor(opts.fill);
        doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
      }
      if (opts.total) {
        doc.setDrawColor(NAVY);
        doc.setLineWidth(0.4);
        doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      }
      font(8.5, opts.header ? WHITE : INK, !!opts.header || !!opts.total);
      let x = MARGIN;
      cells.forEach((cell, i) => {
        const text = pdfSafe(cell);
        if (i === 0) {
          let textX = x + 2;
          if (opts.color) {
            doc.setFillColor(opts.color);
            doc.rect(textX, y + 1.7, 2.8, 2.8, "F");
            textX += 4.6;
          }
          doc.text(lines(text, widths[0] - (textX - x) - 2)[0] ?? "", textX, y + 4.2);
        } else {
          doc.text(text, x + widths[i] - 2, y + 4.2, { align: "right" });
        }
        x += widths[i];
      });
      y += rowH;
    }

    const header = () => row(t.columns, { header: true, fill: NAVY });
    ensureSpace(rowH * 3);
    header();
    const shown = t.rows.slice(0, MAX_TABLE_ROWS);
    shown.forEach((r, i) => {
      if (y + rowH > CONTENT_BOTTOM) {
        newPage();
        header();
      }
      row(r.cells, { fill: i % 2 === 1 ? ZEBRA : undefined, color: r.color });
    });
    if (y + rowH > CONTENT_BOTTOM) newPage();
    row(t.total, { total: true, fill: SKY });
    if (t.rows.length > shown.length) {
      y += 1.5;
      paragraph(`Se muestran las ${MAX_TABLE_ROWS} primeras categorías de ${t.rows.length}; el total las incluye todas.`, 8, MUTED);
    }
    y += 3;
  }

  // ---------------------------------------------------------------- cover

  doc.setFillColor(NAVY);
  doc.rect(0, 0, PAGE_W, 68, "F");
  doc.setFillColor(BLUE);
  doc.rect(0, 68, PAGE_W, 2.2, "F");

  if (settings.logo) {
    doc.setFillColor(WHITE);
    doc.roundedRect(MARGIN, 13, 64, 30, 2, 2, "F");
    const logo = { ...settings.logo, format: "PNG" as const };
    const size = fit(logo, 58, 24);
    doc.addImage(logo.dataUrl, "PNG", MARGIN + (64 - size.w) / 2, 13 + (30 - size.h) / 2, size.w, size.h, undefined, "FAST");
    if (settings.company.trim()) {
      font(13, WHITE, true);
      doc.text(lines(settings.company, 100), PAGE_W - MARGIN, 26, { align: "right" });
    }
  } else if (settings.company.trim()) {
    font(18, WHITE, true);
    doc.text(lines(settings.company, CONTENT_W), MARGIN, 30);
  }
  font(9, "#b9d8f2", true);
  doc.text("INFORME EJECUTIVO", MARGIN, 58, { charSpace: 1.2 });

  y = 84;
  font(25, NAVY, true);
  const titleLines = lines(reportTitle, CONTENT_W);
  doc.text(titleLines, MARGIN, y + 7);
  y += titleLines.length * 25 * LINE + 4;
  paragraph(input.projectName ? `Proyecto: ${input.projectName}` : "Análisis de datos de modelos BIM", 14, INK, false, 6);

  const metaTop = 222;
  if (input.coverImage) {
    const boxH = Math.min(95, metaTop - 12 - y);
    if (boxH > 40) framedImage(input.coverImage, MARGIN, y, CONTENT_W, boxH, "Vista del modelo al generar el informe");
  }

  const meta: [string, string][] = [
    ["Proyecto", input.projectName || "-"],
    ["Fecha de emisión", issuedOn],
    ["Elaborado por", settings.preparedBy.trim() || "-"],
    ["Empresa", settings.company.trim() || "-"],
    ["Modelos analizados", `${input.models.length}`],
    ["Fuente de datos", "Trimble Connect (visor 3D)"],
  ];
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, metaTop, MARGIN + CONTENT_W, metaTop);
  meta.forEach(([label, value], i) => {
    const col = i % 2;
    const rowIndex = Math.floor(i / 2);
    const x = MARGIN + col * (CONTENT_W / 2);
    const top = metaTop + 6 + rowIndex * 14;
    font(7.5, MUTED, true);
    doc.text(pdfSafe(label.toUpperCase()), x, top, { charSpace: 0.4 });
    font(10.5, INK, true);
    doc.text(lines(value, CONTENT_W / 2 - 6)[0] ?? "", x, top + 5.5);
  });
  doc.setDrawColor(NAVY);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, 282, MARGIN + CONTENT_W, 282);
  font(8, MUTED);
  doc.text(pdfSafe("Documento generado con Gráficos de Modelos · Trimble Connect"), MARGIN, 287);
  doc.text("Confidencial", PAGE_W - MARGIN, 287, { align: "right" });

  // ---------------------------------------------------------------- executive summary

  newPage();
  sectionTitle("Resumen ejecutivo");
  const filtered = input.analyzedObjects < input.totalObjects;
  paragraph(
    `Este informe resume ${input.charts.length} ${input.charts.length === 1 ? "gráfico" : "gráficos"} construidos con los datos de ` +
      `${input.models.length} ${input.models.length === 1 ? "modelo" : "modelos"}` +
      (input.projectName ? ` del proyecto ${input.projectName}` : "") +
      `, sobre ${formatNumber(input.analyzedObjects)} objetos${filtered ? " que cumplen los filtros aplicados" : ""}.`,
    10,
    INK,
    false,
    5
  );
  kpiTiles([
    {
      value: formatNumber(input.analyzedObjects),
      label: "Objetos analizados",
      sub: filtered ? `de ${formatNumber(input.totalObjects)} en los modelos` : "todos los de los modelos",
    },
    { value: String(input.models.length), label: input.models.length === 1 ? "Modelo" : "Modelos", sub: "cargados en el visor 3D" },
    { value: String(input.charts.length), label: input.charts.length === 1 ? "Gráfico" : "Gráficos", sub: "incluidos en el informe" },
    { value: String(input.filters.length), label: "Filtros activos", sub: input.filters.length ? "segmentadores aplicados" : "sin filtros" },
  ]);

  subTitle("Hallazgos clave");
  input.charts.forEach((chart, i) => {
    paragraph(`${i + 1}. ${chart.title}`, 9.5, NAVY, true, 1);
    bulletList(chartInsights(chart).slice(0, 2));
    y += 1.5;
  });

  y += 2;
  subTitle("Alcance del análisis");
  paragraph("Modelos", 9, MUTED, true, 1);
  bulletList(input.models.map((m) => `${m.name}: ${formatNumber(m.objects)} objetos`));
  paragraph("Filtros aplicados", 9, MUTED, true, 1);
  bulletList(input.filters.length ? input.filters : ["Ninguno: se incluyen todos los objetos de los modelos."]);

  // Contents: space is reserved now, page numbers are written once they are known.
  const tocEntries = input.charts.length + 2;
  ensureSpace(14 + tocEntries * 6.5);
  y += 2;
  subTitle("Contenido");
  const tocPage = doc.getNumberOfPages();
  const tocTop = y;
  y += tocEntries * 6.5 + 2;

  // ---------------------------------------------------------------- one section per chart

  const sectionPages: number[] = [];
  input.charts.forEach((chart, i) => {
    newPage();
    sectionPages.push(doc.getNumberOfPages());
    font(8.5, BLUE, true);
    doc.text(pdfSafe(`SECCIÓN ${i + 1} · ${chart.typeLabel.toUpperCase()}`), MARGIN, y + 3, { charSpace: 0.5 });
    y += 6;
    paragraph(chart.title, 16, NAVY, true, 1.5);
    paragraph(
      `${formatNumber(chart.coverage.withData)} de ${formatNumber(chart.coverage.total)} objetos tienen estos datos` +
        (chart.compare ? " en los periodos comparados." : "."),
      8.5,
      MUTED,
      false,
      4
    );
    callout("Hallazgos", chartInsights(chart));

    const boxH = 74;
    ensureSpace(boxH + 8);
    if (chart.chartImage && chart.modelImage) {
      const w = (CONTENT_W - 4) / 2;
      framedImage(chart.chartImage, MARGIN, y, w, boxH, "Gráfico");
      framedImage(chart.modelImage, MARGIN + w + 4, y, w, boxH, "Modelo 3D coloreado según el gráfico");
      y += boxH + 8;
    } else if (chart.chartImage || chart.modelImage) {
      const img = (chart.chartImage ?? chart.modelImage)!;
      framedImage(img, MARGIN, y, CONTENT_W, boxH, chart.chartImage ? "Gráfico" : "Modelo 3D coloreado según el gráfico");
      y += boxH + 8;
    }
    if (chart.legend?.length) legend(chart.legend);
    if (chart.modelImage) {
      paragraph("En el modelo, los objetos sin estos datos conservan su color original.", 8, MUTED, false, 3);
    }

    subTitle("Datos");
    table(reportTable(chart));
  });

  // ---------------------------------------------------------------- methodology and sign-off

  newPage();
  const notesPage = doc.getNumberOfPages();
  sectionTitle("Notas metodológicas");
  bulletList([
    `Fuente: propiedades de los objetos de los modelos cargados en el visor 3D de Trimble Connect, leídas el ${issuedOn}.`,
    "Unidades: longitudes en metros (el visor las entrega en milímetros), áreas en m², volúmenes en m³ y masas en kg.",
    "Las fechas se agrupan por mes. Solo se cuentan los objetos que tienen el dato usado en cada gráfico.",
    "Para que cada color identifique una sola categoría, se usan como máximo 8 colores; las categorías menores se agrupan en \"Otros\".",
    "Las capturas muestran el modelo pintado según cada gráfico, con la vista de cámara que había al generar el informe.",
    input.filters.length
      ? `Filtros aplicados a todos los gráficos: ${input.filters.join("; ")}.`
      : "No se aplicaron filtros: se incluyen todos los objetos de los modelos.",
    "La exactitud de los resultados depende de la información registrada en los modelos.",
  ]);

  y += 6;
  sectionTitle("Control del documento");
  const signers: [string, string][] = [
    ["Elaborado por", settings.preparedBy.trim()],
    ["Revisado por", ""],
    ["Aprobado por", ""],
  ];
  const boxW = (CONTENT_W - 8) / 3;
  ensureSpace(46);
  signers.forEach(([role, name], i) => {
    const x = MARGIN + i * (boxW + 4);
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, boxW, 42, 1.5, 1.5, "S");
    font(7.5, MUTED, true);
    doc.text(pdfSafe(role.toUpperCase()), x + 4, y + 6, { charSpace: 0.4 });
    font(9.5, INK, true);
    if (name) doc.text(lines(name, boxW - 8)[0] ?? "", x + 4, y + 12.5);
    doc.setDrawColor(MUTED);
    doc.setLineWidth(0.2);
    font(8, MUTED);
    doc.text("Firma", x + 4, y + 26);
    doc.line(x + 15, y + 26, x + boxW - 4, y + 26);
    doc.text("Fecha", x + 4, y + 36);
    doc.line(x + 15, y + 36, x + boxW - 4, y + 36);
  });
  y += 46;

  // ---------------------------------------------------------------- contents page numbers

  doc.setPage(tocPage);
  const toc: [string, number][] = [
    ["Resumen ejecutivo", 2],
    ...input.charts.map((c, i): [string, number] => [`${i + 1}. ${c.title}`, sectionPages[i]]),
    ["Notas metodológicas y control del documento", notesPage],
  ];
  toc.forEach(([label, page], i) => {
    const top = tocTop + i * 6.5;
    font(9.5, INK);
    doc.text(lines(label, CONTENT_W - 20)[0] ?? "", MARGIN, top + 4);
    font(9.5, NAVY, true);
    doc.text(String(page), PAGE_W - MARGIN, top + 4, { align: "right" });
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, top + 5.8, PAGE_W - MARGIN, top + 5.8);
  });

  // ---------------------------------------------------------------- header and footer (not on the cover)

  const pages = doc.getNumberOfPages();
  const headerLogo = settings.logo ? fit({ ...settings.logo, format: "PNG" }, 24, 7) : null;
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p);
    let textX = MARGIN;
    if (settings.logo && headerLogo) {
      doc.addImage(settings.logo.dataUrl, "PNG", MARGIN, 7.5 - headerLogo.h / 2 + 2, headerLogo.w, headerLogo.h, undefined, "FAST");
      textX += headerLogo.w + 4;
    }
    font(8, MUTED, true);
    doc.text(lines(reportTitle, 100)[0] ?? "", textX, 11);
    font(8, MUTED);
    if (input.projectName) doc.text(lines(input.projectName, 70)[0] ?? "", PAGE_W - MARGIN, 11, { align: "right" });
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 15, PAGE_W - MARGIN, 15);

    doc.line(MARGIN, 284, PAGE_W - MARGIN, 284);
    font(7.5, MUTED);
    const left = [settings.company.trim(), "Confidencial", issuedOn].filter(Boolean).join(" · ");
    doc.text(pdfSafe(left), MARGIN, 289);
    doc.text(`Página ${p} de ${pages}`, PAGE_W - MARGIN, 289, { align: "right" });
  }

  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
