// Builds the "Exportar PDF" report in the browser. jsPDF is loaded on demand,
// so it only costs anything when a report is actually generated.

export interface RasterImage {
  dataUrl: string;
  width: number;
  height: number;
  format: "PNG" | "JPEG";
}

export interface ReportTableRow {
  cells: string[];
  /** Swatch drawn before the first cell: the color the category has in the chart and the model. */
  color?: string;
}

export interface ReportChart {
  typeLabel: string;
  title: string;
  columns: string[];
  rows: ReportTableRow[];
  note: string;
  /** Color key drawn under the model when the table rows can't carry it (e.g. A vs B). */
  legend?: { color: string; label: string }[];
  chartImage: RasterImage | null;
  modelImage: RasterImage | null;
}

export interface ReportInput {
  projectName: string;
  generatedAt: Date;
  models: string[];
  filters: string[];
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

const PAGE = { width: 210, height: 297, margin: 15 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const BLUE = "#0a3d62";
const GRAY = "#6b7684";
const INK = "#3c4550";
const RULE = "#d7dee6";
const MAX_TABLE_ROWS = 40;

export async function buildReportPdf(input: ReportInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  let y = PAGE.margin;

  function newPage() {
    doc.addPage();
    y = PAGE.margin;
  }

  function ensureSpace(height: number) {
    if (y + height > PAGE.height - PAGE.margin - 8) newPage();
  }

  function text(value: string, size: number, color: string, bold = false, gapAfter = 1.5) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(pdfSafe(value), CONTENT_WIDTH) as string[];
    const lineHeight = size * 0.42;
    ensureSpace(lines.length * lineHeight);
    doc.text(lines, PAGE.margin, y + lineHeight * 0.8);
    y += lines.length * lineHeight + gapAfter;
  }

  function image(img: RasterImage, maxHeight: number) {
    const ratio = img.height / img.width;
    let w = CONTENT_WIDTH;
    let h = w * ratio;
    if (h > maxHeight) {
      h = maxHeight;
      w = h / ratio;
    }
    ensureSpace(h + 2);
    doc.setDrawColor(RULE);
    doc.addImage(img.dataUrl, img.format, PAGE.margin + (CONTENT_WIDTH - w) / 2, y, w, h, undefined, "FAST");
    doc.rect(PAGE.margin + (CONTENT_WIDTH - w) / 2, y, w, h);
    y += h + 4;
  }

  function legend(items: { color: string; label: string }[]) {
    ensureSpace(7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK);
    let x = PAGE.margin;
    for (const item of items) {
      const label = pdfSafe(item.label);
      doc.setFillColor(item.color);
      doc.rect(x, y + 0.8, 3, 3, "F");
      doc.text(label, x + 4.5, y + 3.4);
      x += 4.5 + doc.getTextWidth(label) + 8;
    }
    y += 8;
  }

  function table(columns: string[], rows: ReportTableRow[]) {
    // First column takes the remaining width; number columns are right-aligned.
    const numberWidth = 32;
    const widths = [CONTENT_WIDTH - numberWidth * (columns.length - 1), ...columns.slice(1).map(() => numberWidth)];
    const rowHeight = 6;

    function header() {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(GRAY);
      let x = PAGE.margin;
      columns.forEach((col, i) => {
        const label = pdfSafe(col);
        if (i === 0) doc.text(label, x + 1, y + 4);
        else doc.text(label, x + widths[i] - 1, y + 4, { align: "right" });
        x += widths[i];
      });
      doc.setDrawColor(RULE);
      doc.line(PAGE.margin, y + rowHeight, PAGE.margin + CONTENT_WIDTH, y + rowHeight);
      y += rowHeight;
    }

    ensureSpace(rowHeight * 2);
    header();
    const shown = rows.slice(0, MAX_TABLE_ROWS);
    for (const row of shown) {
      if (y + rowHeight > PAGE.height - PAGE.margin - 8) {
        newPage();
        header();
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(INK);
      let x = PAGE.margin;
      row.cells.forEach((cell, i) => {
        const value = pdfSafe(cell);
        if (i === 0) {
          let textX = x + 1;
          if (row.color) {
            doc.setFillColor(row.color);
            doc.rect(x + 1, y + 1.5, 3, 3, "F");
            textX += 5;
          }
          const [line] = doc.splitTextToSize(value, widths[0] - (textX - x) - 2) as string[];
          doc.text(line ?? "", textX, y + 4);
        } else {
          doc.text(value, x + widths[i] - 1, y + 4, { align: "right" });
        }
        x += widths[i];
      });
      doc.setDrawColor("#f0f3f6");
      doc.line(PAGE.margin, y + rowHeight, PAGE.margin + CONTENT_WIDTH, y + rowHeight);
      y += rowHeight;
    }
    if (rows.length > shown.length) {
      y += 1;
      text(`... y ${rows.length - shown.length} categorías más.`, 8.5, GRAY);
    }
    y += 2;
  }

  // Cover page
  text("Informe de gráficos de modelos", 20, BLUE, true, 2);
  if (input.projectName) text(`Proyecto: ${input.projectName}`, 12, INK, false, 1);
  text(`Generado el ${input.generatedAt.toLocaleString("es")}`, 10, GRAY, false, 6);

  text("Modelos incluidos", 12, BLUE, true);
  for (const model of input.models) text(`- ${model}`, 10, INK, false, 0.5);
  y += 4;

  text("Filtros aplicados (segmentadores)", 12, BLUE, true);
  if (input.filters.length === 0) text("Ninguno: se incluyen todos los objetos.", 10, INK);
  for (const filter of input.filters) text(`- ${filter}`, 10, INK, false, 0.5);
  y += 4;

  text("Contenido", 12, BLUE, true);
  input.charts.forEach((chart, i) => text(`${i + 1}. ${chart.title} (${chart.typeLabel})`, 10, INK, false, 0.5));

  // One section per chart: the chart, the model colored like it, and its data.
  input.charts.forEach((chart, i) => {
    newPage();
    text(`${i + 1}. ${chart.typeLabel.toUpperCase()}`, 9, GRAY, true, 0.5);
    text(chart.title, 14, BLUE, true, 3);
    // Sized so a chart with up to ~8 categories fits on one page with its model and table.
    if (chart.chartImage) image(chart.chartImage, 78);
    if (chart.modelImage) {
      text("Modelo 3D coloreado según el gráfico (los objetos sin estos datos conservan su color)", 10, INK, true, 1.5);
      image(chart.modelImage, 76);
    }
    if (chart.legend?.length) legend(chart.legend);
    table(chart.columns, chart.rows);
    if (chart.note) text(chart.note, 8.5, GRAY);
  });

  // Footer with page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY);
    doc.text(pdfSafe(`Gráficos de Modelos · Trimble Connect`), PAGE.margin, PAGE.height - 8);
    doc.text(`Página ${p} de ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 8, { align: "right" });
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
