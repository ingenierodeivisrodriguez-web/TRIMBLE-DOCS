import { FileRecord, ProjectMeta, SummaryResponse, TimelinePoint, TypeAggregate } from "./types";

function buildByType(files: FileRecord[]): TypeAggregate[] {
  const map = new Map<string, TypeAggregate>();
  for (const file of files) {
    const entry = map.get(file.ext) ?? { ext: file.ext, count: 0, size: 0 };
    entry.count += 1;
    entry.size += file.size;
    map.set(file.ext, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function startOfWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // Monday-based week
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function buildTimeline(
  files: FileRecord[],
  projectCreatedOn: string,
  granularity: "week" | "month"
): TimelinePoint[] {
  const sortedDates = files
    .map((f) => new Date(f.modifiedOn).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  const today = new Date();
  // Start at the earliest document's own date rather than the project's
  // creation date: many projects sit empty for a while before the first
  // upload, which would otherwise stretch the chart with a flat, empty lead-in.
  let start = sortedDates.length > 0 ? new Date(sortedDates[0]) : new Date(projectCreatedOn);
  if (Number.isNaN(start.getTime())) {
    start = today;
  }

  const buckets: Date[] = [];
  if (granularity === "week") {
    let cursor = startOfWeek(start);
    const last = startOfWeek(today);
    while (cursor.getTime() <= last.getTime()) {
      buckets.push(new Date(cursor));
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  } else {
    let cursor = startOfMonth(start);
    const last = startOfMonth(today);
    while (cursor.getTime() <= last.getTime()) {
      buckets.push(new Date(cursor));
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }
  if (buckets.length === 0) buckets.push(start);

  const points: TimelinePoint[] = [];
  let idx = 0;
  for (const bucketStart of buckets) {
    const bucketEnd =
      granularity === "week"
        ? new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
        : new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1) - 1);
    const effectiveEnd = Math.min(bucketEnd.getTime(), today.getTime());
    while (idx < sortedDates.length && sortedDates[idx] <= effectiveEnd) idx++;
    points.push({ date: bucketStart.toISOString().slice(0, 10), cumulative: idx });
  }

  // Make sure the very last point reflects "today" exactly.
  if (points.length > 0) {
    points[points.length - 1].cumulative = sortedDates.length;
  }

  return points;
}

export function buildSummary(project: ProjectMeta, files: FileRecord[]): SummaryResponse {
  const byType = buildByType(files);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    project,
    totals: {
      filesCount: files.length,
      typesCount: byType.length,
      totalSize,
    },
    byType,
    timeline: {
      weekly: buildTimeline(files, project.createdOn, "week"),
      monthly: buildTimeline(files, project.createdOn, "month"),
    },
  };
}
