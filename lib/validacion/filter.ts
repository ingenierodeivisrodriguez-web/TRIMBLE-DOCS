import type { NonConformingRow, TemplateKey, UnclassifiedRow } from "./types";

export interface NonConformingFilters {
  template?: TemplateKey;
  /** Keep only files with an issue in this field (the label used in the summary). */
  field?: string;
  /** Free text matched against name, folder and the issue messages. */
  q?: string;
}

export interface UnclassifiedFilters {
  ext?: string;
  q?: string;
}

const norm = (value: string) => value.toLocaleLowerCase("es");

export function filterNonConforming(
  rows: NonConformingRow[],
  filters: NonConformingFilters
): NonConformingRow[] {
  const q = filters.q?.trim() ? norm(filters.q.trim()) : "";
  return rows.filter((row) => {
    if (filters.template && row.template !== filters.template) return false;
    if (filters.field && !row.issues.some((i) => i.fieldLabel === filters.field)) return false;
    if (q) {
      const haystack = norm(`${row.name} ${row.folderPath} ${row.issues.map((i) => i.message).join(" ")}`);
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function filterUnclassified(rows: UnclassifiedRow[], filters: UnclassifiedFilters): UnclassifiedRow[] {
  const q = filters.q?.trim() ? norm(filters.q.trim()) : "";
  return rows.filter((row) => {
    if (filters.ext && row.ext !== filters.ext) return false;
    if (q && !norm(`${row.name} ${row.folderPath}`).includes(q)) return false;
    return true;
  });
}
