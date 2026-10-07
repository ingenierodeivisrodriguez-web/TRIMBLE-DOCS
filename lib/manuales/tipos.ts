// How each kind of file is shown in "Manuales".

/** pdf: inline PDF · imagen/video/audio: straight from storage · texto: as text · convertir: a PDF rendition from Trimble Connect · ninguna: download or open in Trimble Connect. */
export type Vista = "pdf" | "imagen" | "video" | "audio" | "texto" | "convertir" | "ninguna";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

const VISTAS: [Vista, string[]][] = [
  ["pdf", ["pdf"]],
  ["imagen", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]],
  ["video", ["mp4", "m4v", "webm", "ogv", "mov"]],
  ["audio", ["mp3", "wav", "m4a"]],
  ["texto", ["txt", "log", "md", "csv"]],
  ["convertir", ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "odt", "ods", "odp", "dwg", "dxf"]],
];

export function vistaDe(ext: string): Vista {
  return VISTAS.find(([, exts]) => exts.includes(ext))?.[0] ?? "ninguna";
}

export function tipoMime(ext: string, delAlmacen?: string | null): string {
  return MIME[ext] ?? delAlmacen ?? "application/octet-stream";
}

/** A short label and color for the file's icon. */
export function etiquetaTipo(ext: string): { label: string; color: string } {
  if (ext === "pdf") return { label: "PDF", color: "#c62828" };
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return { label: "DOC", color: "#1e5bb8" };
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return { label: "XLS", color: "#1d7a3e" };
  if (["ppt", "pptx", "odp"].includes(ext)) return { label: "PPT", color: "#c4511d" };
  if (["dwg", "dxf"].includes(ext)) return { label: ext.toUpperCase(), color: "#5b4fa8" };
  const v = vistaDe(ext);
  if (v === "imagen") return { label: "IMG", color: "#7b3fa0" };
  if (v === "video") return { label: "VID", color: "#0f6c80" };
  if (v === "audio") return { label: "AUD", color: "#0f6c80" };
  if (v === "texto") return { label: "TXT", color: "#56606b" };
  return { label: (ext || "?").slice(0, 4).toUpperCase(), color: "#6b7684" };
}
