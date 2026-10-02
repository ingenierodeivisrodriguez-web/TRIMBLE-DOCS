// "Simulador": a timeline built from a date field of the model elements
// (native or an attribute of this app). Elements appear in the 3D viewer as
// the timeline reaches their date; the progress is the share of the dated
// elements already shown.
import type { Members, ModelDataset } from "../graficos/modelData";

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
