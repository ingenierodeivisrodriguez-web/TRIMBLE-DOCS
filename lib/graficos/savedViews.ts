import type { FieldKind, SlicerSpec } from "./modelData";

export type ChartType = "column" | "horizontal" | "donut" | "compare";

/** Configuration of one chart card. */
export interface CardSpec {
  type: ChartType;
  category: string | null;
  value: string | null;
  /** Comparison only: the field that tells side A from side B (a date is compared by month). */
  compareBy: string | null;
  periodA: string | null;
  periodB: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  savedAt: string;
  /** Models by file id (not version), so a view still opens after a model is updated. */
  models: { id: string; name: string }[];
  charts: CardSpec[];
  slicers: SlicerSpec[];
}

export const MAX_SAVED_VIEWS = 30;

const CHART_TYPES = new Set<ChartType>(["column", "horizontal", "donut", "compare"]);
const FIELD_KINDS = new Set<FieldKind>(["text", "number", "date"]);

function storageKey(projectId: string): string {
  return `graficos-modelos:vistas:${projectId}`;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

function parseChart(raw: unknown): CardSpec | null {
  const c = raw as Partial<CardSpec> | null;
  if (!c || !CHART_TYPES.has(c.type as ChartType)) return null;
  const { category, value, compareBy, periodA, periodB } = c;
  if (![category, value, compareBy, periodA, periodB].every(isNullableString)) return null;
  return {
    type: c.type as ChartType,
    category: category ?? null,
    value: value ?? null,
    compareBy: compareBy ?? null,
    periodA: periodA ?? null,
    periodB: periodB ?? null,
  };
}

function parseSlicer(raw: unknown): SlicerSpec | null {
  const s = raw as Partial<SlicerSpec> | null;
  if (!s || !isString(s.field) || !FIELD_KINDS.has(s.kind as FieldKind)) return null;
  if (s.selected !== null && !(Array.isArray(s.selected) && s.selected.every(isString))) return null;
  return { field: s.field, kind: s.kind as FieldKind, selected: s.selected ?? null };
}

function parseView(raw: unknown): SavedView | null {
  const v = raw as Partial<SavedView> | null;
  if (!v || !isString(v.id) || !isString(v.name) || !isString(v.savedAt)) return null;
  if (!Array.isArray(v.models) || !Array.isArray(v.charts) || !Array.isArray(v.slicers)) return null;
  const models = v.models.filter((m): m is { id: string; name: string } => !!m && isString(m.id) && isString(m.name));
  const charts = v.charts.map(parseChart);
  if (charts.some((c) => c === null)) return null;
  return {
    id: v.id,
    name: v.name,
    savedAt: v.savedAt,
    models,
    charts: charts as CardSpec[],
    slicers: v.slicers.map(parseSlicer).filter((s): s is SlicerSpec => s !== null),
  };
}

/** Parses what's in storage, dropping anything that doesn't look like a saved view. */
export function parseViews(json: string | null): SavedView[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    return Array.isArray(data) ? data.map(parseView).filter((v): v is SavedView => v !== null) : [];
  } catch {
    return [];
  }
}

/** Newest first, capped at MAX_SAVED_VIEWS. */
export function addView(views: SavedView[], view: SavedView): SavedView[] {
  return [view, ...views.filter((v) => v.id !== view.id)].slice(0, MAX_SAVED_VIEWS);
}

// Views live in this browser only (per project). Storage can be unavailable
// (private mode, blocked third-party storage inside the Trimble iframe), in
// which case saving silently does nothing beyond the current session.
export function loadViews(projectId: string): SavedView[] {
  try {
    return parseViews(window.localStorage.getItem(storageKey(projectId)));
  } catch {
    return [];
  }
}

export function storeViews(projectId: string, views: SavedView[]): boolean {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}
