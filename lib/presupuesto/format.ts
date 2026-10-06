// How numbers read in the budget: thousands with commas and a decimal point,
// like the reference budget (284,571.31).

const formats = new Map<number, Intl.NumberFormat>();

export function fmt(n: number, decimales = 2): string {
  let f = formats.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    formats.set(decimales, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}

/** The number as typed in an input: no thousands separators, no trailing zeros. */
export function editable(n: number | null, decimales = 4): string {
  if (n === null || !Number.isFinite(n)) return "";
  return String(Number(n.toFixed(decimales)));
}

/** Lower case without accents, for searching. */
export function plegar(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** True when every word of `query` appears in `text` (accent- and case-insensitive). */
export function coincide(text: string, query: string): boolean {
  const words = plegar(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const t = plegar(text);
  return words.every((w) => t.includes(w));
}

/** "2026-10-05T…" -> "05-10-2026" (dates are always shown DD-MM-AAAA). */
export function fecha(timestamp: string | null): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
