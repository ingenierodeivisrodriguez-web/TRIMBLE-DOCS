// "Simulador": a timeline built from a date field of the model elements
// (native or an attribute of this app). Elements appear in the 3D viewer as
// the timeline reaches their date; the progress is the share of the dated
// elements already shown.
import { aggregate, ChartResult, ChartRow, FieldKind, foldRows, mergeMembers, Members, ModelDataset, OTHER_KEY } from "../graficos/modelData";

const DAY_MS = 86_400_000;

/** "2026-05-20" (or a timestamp starting with it) -> days since 1970-01-01, or null if it isn't a date. */
export function dayNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS);
}

/** Days since 1970-01-01 -> "2026-05-20". */
export function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today in the user's calendar, as a day number. */
export function today(): number {
  const now = new Date();
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

export interface TimelineItem {
  day: number;
  /** Dataset (model) key. */
  model: string;
  runtimeId: number;
}

export interface Timeline {
  /** Elements with a date, earliest first. */
  items: TimelineItem[];
  /** Elements of the same models without that date, per model. */
  undated: Members;
  undatedCount: number;
  /** First and last date (day numbers); null when no element has the date. */
  start: number | null;
  end: number | null;
}

/** Every element with a value for `fieldKey`, ordered by that date, and the ones without it. */
export function buildTimeline(datasets: ModelDataset[], fieldKey: string): Timeline {
  const items: TimelineItem[] = [];
  const undated: Members = {};
  let undatedCount = 0;
  for (const dataset of datasets) {
    for (const record of dataset.records) {
      const day = dayNumber(record.values[fieldKey]);
      if (day === null) {
        (undated[dataset.modelId] ??= []).push(record.runtimeId);
        undatedCount++;
      } else {
        items.push({ day, model: dataset.modelId, runtimeId: record.runtimeId });
      }
    }
  }
  items.sort((a, b) => a.day - b.day);
  return {
    items,
    undated,
    undatedCount,
    start: items.length ? items[0].day : null,
    end: items.length ? items[items.length - 1].day : null,
  };
}

/** How many items have a date on or before `day` (items are sorted by day). */
export function countUpTo(items: TimelineItem[], day: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].day <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Items [from, to) as runtime ids per model, for a viewer selector. */
export function membersOf(items: TimelineItem[], from: number, to: number): Members {
  const out: Members = {};
  for (let i = Math.max(0, from); i < Math.min(items.length, to); i++) {
    (out[items[i].model] ??= []).push(items[i].runtimeId);
  }
  return out;
}

/** Share of the dated elements shown, 0-100. */
export function progressPercent(shown: number, total: number): number {
  return total === 0 ? 0 : (shown / total) * 100;
}

/**
 * The cumulative progress curve (an "S curve") sampled at `points` evenly
 * spaced days between start and end: each value is the % of elements with a
 * date on or before that day.
 */
export function progressCurve(items: TimelineItem[], start: number, end: number, points = 60): number[] {
  if (items.length === 0) return [];
  const span = Math.max(0, end - start);
  return Array.from({ length: points + 1 }, (_, i) => {
    const day = start + (span * i) / points;
    return progressPercent(countUpTo(items, Math.floor(day)), items.length);
  });
}

/** Members of several models merged into one (no element appears twice in a timeline). */
export function memberCount(members: Members): number {
  return Object.values(members).reduce((sum, ids) => sum + ids.length, 0);
}

// ---------------------------------------------------------------- charts of the progress

/** The datasets reduced to the elements with the date, each sorted by it (with the day of each record). */
export interface DatedDataset {
  dataset: ModelDataset;
  /** Day of each record of `dataset.records`, ascending. */
  days: number[];
}

export function datedDatasets(datasets: ModelDataset[], fieldKey: string): DatedDataset[] {
  return datasets.map((dataset) => {
    const dated = dataset.records
      .map((record) => ({ record, day: dayNumber(record.values[fieldKey]) }))
      .filter((r): r is { record: (typeof dataset.records)[number]; day: number } => r.day !== null)
      .sort((a, b) => a.day - b.day);
    return { dataset: { ...dataset, records: dated.map((r) => r.record) }, days: dated.map((r) => r.day) };
  });
}

/** How many of the ascending `days` are on or before `day`. */
function upTo(days: number[], day: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The elements already shown on `day`: each dataset cut at that date (null: none yet). */
export function shownDatasets(dated: DatedDataset[], day: number | null): ModelDataset[] {
  return dated.map(({ dataset, days }) => ({
    ...dataset,
    records: dataset.records.slice(0, day === null ? 0 : upTo(days, day)),
  }));
}

export interface ProgressChart {
  /** The final categories (fixed order) with the values of the elements shown so far. */
  rows: ChartRow[];
  /** The same categories with their final values. */
  finalRows: ChartRow[];
  /** Top of the scale: the largest final value. */
  maxValue: number;
  /** Elements with the chart's data: shown so far / in the whole timeline. */
  shownWithData: number;
  totalWithData: number;
}

/**
 * A chart at a moment of the simulation: categories and scale come from the
 * whole timeline (`final`: the chart of every dated element, computed once),
 * so bars grow toward their final size instead of the axis rescaling and the
 * bars reordering; the values come from the elements shown so far.
 */
export function progressChart(
  final: ChartResult,
  shown: ModelDataset[],
  spec: { category: string; categoryKind: FieldKind; value: string | null },
  maxRows: number
): ProgressChart {
  const chronological = spec.categoryKind === "date";
  const finalRows = foldRows(final.rows, maxRows, chronological);
  const current = aggregate(shown, spec);
  const byKey = new Map(current.rows.map((r) => [r.key, r]));
  const kept = new Set(finalRows.filter((r) => r.key !== OTHER_KEY).map((r) => r.key));
  const rows = finalRows.map((row) => {
    if (row.key === OTHER_KEY) {
      const rest = current.rows.filter((r) => !kept.has(r.key));
      return {
        ...row,
        value: rest.reduce((sum, r) => sum + r.value, 0),
        objects: rest.reduce((sum, r) => sum + r.objects, 0),
        members: mergeMembers(rest.map((r) => r.members)),
      };
    }
    const now = byKey.get(row.key);
    return now ? { ...row, value: now.value, objects: now.objects, members: now.members } : { ...row, value: 0, objects: 0, members: {} };
  });
  return {
    rows,
    finalRows,
    maxValue: finalRows.reduce((max, r) => Math.max(max, r.value), 0),
    shownWithData: current.objectsWithData,
    totalWithData: final.objectsWithData,
  };
}

/** Elements of `all` left out of `kept` (the same datasets, filtered by slicers), per model. */
export function excludedMembers(all: ModelDataset[], kept: ModelDataset[]): { members: Members; count: number } {
  const keptIds = new Map(kept.map((d) => [d.modelId, new Set(d.records.map((r) => r.runtimeId))]));
  const members: Members = {};
  let count = 0;
  for (const dataset of all) {
    const ids = keptIds.get(dataset.modelId);
    for (const record of dataset.records) {
      if (ids?.has(record.runtimeId)) continue;
      (members[dataset.modelId] ??= []).push(record.runtimeId);
      count++;
    }
  }
  return { members, count };
}

// ---------------------------------------------------------------- progress of a day

/** Elements whose date falls in [fromDay, toDay], as a count and a share of all the items. */
export function periodProgress(items: TimelineItem[], fromDay: number, toDay: number): { count: number; percent: number } {
  const count = Math.max(0, countUpTo(items, toDay) - countUpTo(items, fromDay - 1));
  return { count, percent: progressPercent(count, items.length) };
}

export interface DailyBar {
  /** First and last day of the bar (a bar covers several days on long timelines). */
  from: number;
  to: number;
  count: number;
  percent: number;
}

/**
 * The progress of each day of the timeline, as bars: one per day, or per
 * group of consecutive days when the timeline is longer than `maxBars` days.
 */
export function dailyBars(items: TimelineItem[], start: number, end: number, maxBars = 60): { days: number; bars: DailyBar[] } {
  if (items.length === 0 || end < start) return { days: 1, bars: [] };
  const span = end - start + 1;
  const days = Math.max(1, Math.ceil(span / maxBars));
  const bars: DailyBar[] = [];
  for (let from = start; from <= end; from += days) {
    const to = Math.min(end, from + days - 1);
    bars.push({ from, to, ...periodProgress(items, from, to) });
  }
  return { days, bars };
}
