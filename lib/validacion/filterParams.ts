import type { ResultsTab, TemplateKey } from "./types";

/** What the user has selected to narrow down the results (by clicking cards, charts, chips or searching). */
export interface ResultFilters {
  template: TemplateKey | null;
  field: string | null;
  ext: string | null;
  q: string;
}

export const NO_FILTERS: ResultFilters = { template: null, field: null, ext: null, q: "" };

/** The query-string parameters the results/export endpoints understand for this tab. */
export function filterParams(tab: ResultsTab, filters: ResultFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (tab === "nonconforming") {
    if (filters.template) params.template = filters.template;
    if (filters.field) params.field = filters.field;
  } else if (filters.ext) {
    params.ext = filters.ext;
  }
  if (filters.q.trim()) params.q = filters.q.trim();
  return params;
}

export function hasActiveFilters(tab: ResultsTab, filters: ResultFilters): boolean {
  return Object.keys(filterParams(tab, filters)).length > 0;
}
