import { AttributeValue, DataType, MAX_TEXT_LENGTH } from "./types";

// ---------------------------------------------------------------- dates

const pad = (n: number) => String(n).padStart(2, "0");

/** True for a real calendar date in ISO form, e.g. "2026-05-20" (not "2026-02-30"). */
export function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** "2026-05-20" -> "20-05-2026": the only date format users see. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * Reads what the user typed as a day-first date: "20-05-2026", also "20/5/2026"
 * or "20.05.2026". Returns ISO "2026-05-20", or null if it isn't a real date.
 */
export function parseDisplayDate(text: string): string | null {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(text);
  if (!m) return null;
  const iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return isValidIsoDate(iso) ? iso : null;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ---------------------------------------------------------------- numbers

/**
 * Reads a number typed with a comma or a dot as decimal separator ("12,5",
 * "12.5"). When both appear, the last one is the decimal separator and the
 * others group thousands ("1.234,5" or "1,234.5"); a separator repeated alone
 * groups thousands too ("1.234.567").
 */
export function parseNumberInput(text: string): number | null {
  let s = text.trim().replace(/\s+/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    s = s.split(group).join("").replace(decimal, ".");
  } else {
    const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    if (sep) {
      const parts = s.split(sep);
      s = parts.length > 2 ? parts.join("") : parts.join(".");
    }
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** How a number is shown for editing: decimal comma, no thousands grouping. */
export function formatNumberInput(n: number): string {
  return n.toLocaleString("es", { useGrouping: false, maximumFractionDigits: 10 });
}

// ---------------------------------------------------------------- any type

/** Human-readable value: dates as DD-MM-AAAA, booleans as Sí/No, numbers with decimal comma. */
export function formatValue(dataType: DataType, value: AttributeValue): string {
  switch (dataType) {
    case "date":
      return isoToDisplay(String(value));
    case "boolean":
      return value ? "Sí" : "No";
    case "number":
      return typeof value === "number" ? value.toLocaleString("es", { maximumFractionDigits: 10 }) : String(value);
    default:
      return String(value);
  }
}

export type Validation = { ok: true; value: AttributeValue } | { ok: false; error: string };

/** Server-side check that a JSON value fits the attribute's type. */
export function validateValue(dataType: DataType, value: unknown): Validation {
  switch (dataType) {
    case "text": {
      if (typeof value !== "string") return { ok: false, error: "debe ser un texto" };
      const text = value.trim();
      if (!text) return { ok: false, error: "el texto está vacío (para quitar el valor, envía null)" };
      if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: `el texto supera ${MAX_TEXT_LENGTH} caracteres` };
      return { ok: true, value: text };
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, error: "debe ser un número" };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "debe ser sí o no (true/false)" };
    case "date":
      return typeof value === "string" && isValidIsoDate(value)
        ? { ok: true, value }
        : { ok: false, error: "debe ser una fecha válida (AAAA-MM-DD)" };
  }
}

export function sameValue(a: AttributeValue | undefined, b: AttributeValue | undefined): boolean {
  return a === b;
}
