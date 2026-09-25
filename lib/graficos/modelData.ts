// Numeric codes of the Workspace API's PropertyType. The package declares it
// as a `const enum`, which can't be referenced as a value under Next.js's
// isolatedModules, so the values are mirrored here.
const TYPE = {
  Length: 0,
  Area: 1,
  Volume: 2,
  Mass: 3,
  Angle: 4,
  String: 5,
  Int: 6,
  Double: 7,
  DateTime: 8,
  Logical: 9,
  Boolean: 10,
} as const;

const NUMERIC_TYPES = new Set<number>([
  TYPE.Length,
  TYPE.Area,
  TYPE.Volume,
  TYPE.Mass,
  TYPE.Angle,
  TYPE.Int,
  TYPE.Double,
]);

// The viewer reports lengths in mm, areas in m², volumes in m³, masses in kg.
// Lengths are converted to m so that sums (e.g. total length of beams) stay readable.
const UNITS: Partial<Record<number, string>> = {
  [TYPE.Length]: "m",
  [TYPE.Area]: "m²",
  [TYPE.Volume]: "m³",
  [TYPE.Mass]: "kg",
  [TYPE.Angle]: "°",
};

/** Shape of `viewer.getObjectProperties` results (kept loose: the viewer's data is untyped at runtime). */
export interface RawObject {
  id: number;
  class?: string;
  product?: { name?: string; description?: string; objectType?: string };
  properties?: { name?: string; properties?: { name: string; value: unknown; type: number }[] }[];
}

/** "date" values are stored as ISO "YYYY-MM-DD" strings and grouped by month. */
export type FieldKind = "number" | "text" | "date";

export interface Field {
  /** Unique key: "@model" / "@class" / ... for built-ins, "Set · Property" otherwise. */
  key: string;
  label: string;
  group: string;
  kind: FieldKind;
  unit?: string;
}

export type FieldValue = string | number;

export interface ObjectRecord {
  runtimeId: number;
  values: Record<string, FieldValue>;
}

/** Everything read from one model, ready for charting. */
export interface ModelDataset {
  modelId: string;
  modelName: string;
  records: ObjectRecord[];
  fields: Map<string, Field>;
  /** How many objects of the model carry each field. */
  coverage: Map<string, number>;
}

/** Runtime ids of the objects behind a bar / slice, per dataset (ModelDataset.modelId). */
export type Members = Record<string, number[]>;

export const GENERAL_GROUP = "General";

const BUILT_IN_FIELDS: Field[] = [
  { key: "@model", label: "Modelo", group: GENERAL_GROUP, kind: "text" },
  { key: "@class", label: "Clase", group: GENERAL_GROUP, kind: "text" },
  { key: "@name", label: "Nombre", group: GENERAL_GROUP, kind: "text" },
  { key: "@objectType", label: "Tipo", group: GENERAL_GROUP, kind: "text" },
];
const BUILT_IN_ORDER = new Map(BUILT_IN_FIELDS.map((f, i) => [f.key, i]));

// ---------------------------------------------------------------- dates

// Only whole-value matches count as dates, so "12/05/2024 - Rev B" stays text.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DMY_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/;

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Recognises "2026-03-15[Thh:mm...]" and day-first "15/03/2026" (or US "03/15/2026" when unambiguous). */
export function parseDateText(text: string): string | null {
  const iso = ISO_DATE.exec(text);
  if (iso) return isoDate(+iso[1], +iso[2], +iso[3]);
  const dmy = DMY_DATE.exec(text);
  if (dmy) {
    let day = +dmy[1];
    let month = +dmy[2];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return isoDate(+dmy[3], month, day);
  }
  return null;
}

/** The viewer's DateTime values are UNIX timestamps (seconds, or ms), possibly as BigInt. */
function timestampToIso(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n < 1e11 ? n * 1000 : n);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const MONTH_FORMAT = new Intl.DateTimeFormat("es", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-03" -> "mar 2026" */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return MONTH_FORMAT.format(new Date(Date.UTC(year, month - 1, 1))).replace(".", "");
}

// ---------------------------------------------------------------- reading

function convert(type: number, value: unknown): { kind: FieldKind; value: FieldValue } | null {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC_TYPES.has(type)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return { kind: "number", value: type === TYPE.Length ? n / 1000 : n };
  }
  if (type === TYPE.DateTime) {
    const iso = typeof value === "string" ? (parseDateText(value.trim()) ?? timestampToIso(value)) : timestampToIso(value);
    return iso ? { kind: "date", value: iso } : null;
  }
  if (type === TYPE.Logical || type === TYPE.Boolean) {
    const truthy = value === true || value === 1 || value === "1" || value === "true";
    return { kind: "text", value: truthy ? "Sí" : "No" };
  }
  const text = String(value).trim();
  if (!text) return null;
  const iso = parseDateText(text);
  return iso ? { kind: "date", value: iso } : { kind: "text", value: text };
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** True if the viewer returned any property data at all for this object. */
export function objectHasData(obj: RawObject): boolean {
  return (obj.properties ?? []).some((set) => (set.properties ?? []).length > 0);
}

export function buildDataset(modelId: string, modelName: string, objects: RawObject[]): ModelDataset {
  const fields = new Map<string, Field>();
  const coverage = new Map<string, number>();
  const records: ObjectRecord[] = [];

  function record(values: Record<string, FieldValue>, field: Field, value: FieldValue) {
    if (field.key in values) return; // first occurrence wins, like the viewer's own property panel
    values[field.key] = value;
    const known = fields.get(field.key);
    if (!known) fields.set(field.key, field);
    else if (known.kind !== field.kind) fields.set(field.key, { ...known, kind: "text", unit: undefined });
    coverage.set(field.key, (coverage.get(field.key) ?? 0) + 1);
  }

  const [modelField, classField, nameField, typeField] = BUILT_IN_FIELDS;

  for (const obj of objects) {
    const values: Record<string, FieldValue> = {};
    record(values, modelField, modelName);
    const cls = nonEmpty(obj.class);
    if (cls) record(values, classField, cls);
    const name = nonEmpty(obj.product?.name);
    if (name) record(values, nameField, name);
    const objectType = nonEmpty(obj.product?.objectType);
    if (objectType) record(values, typeField, objectType);

    for (const set of obj.properties ?? []) {
      const group = nonEmpty(set.name) ?? "Propiedades";
      for (const prop of set.properties ?? []) {
        if (!prop || prop.name == null) continue;
        const converted = convert(prop.type, prop.value);
        if (!converted) continue;
        record(
          values,
          {
            key: `${group} · ${prop.name}`,
            label: String(prop.name),
            group,
            kind: converted.kind,
            unit: converted.kind === "number" ? UNITS[prop.type] : undefined,
          },
          converted.value
        );
      }
    }
    records.push({ runtimeId: obj.id, values });
  }

  return { modelId, modelName, records, fields, coverage };
}

// ---------------------------------------------------------------- common fields

export interface CommonField extends Field {
  /** Objects (across all given models) that carry this field. */
  objectCount: number;
}

/**
 * Fields present in every given model (in at least one object each). A field
 * whose kind differs between models is offered as text. Built-ins come first,
 * then the most widespread fields.
 */
export function commonFields(datasets: ModelDataset[]): CommonField[] {
  if (datasets.length === 0) return [];
  const [first, ...rest] = datasets;
  const result: CommonField[] = [];

  for (const [key, field] of first.fields) {
    if (!rest.every((d) => d.fields.has(key))) continue;
    const kinds = new Set(datasets.map((d) => d.fields.get(key)!.kind));
    const kind: FieldKind = kinds.size === 1 ? field.kind : "text";
    result.push({
      ...field,
      kind,
      unit: kind === "number" ? field.unit : undefined,
      objectCount: datasets.reduce((sum, d) => sum + (d.coverage.get(key) ?? 0), 0),
    });
  }

  return result.sort((a, b) => {
    const aBuiltIn = BUILT_IN_ORDER.get(a.key);
    const bBuiltIn = BUILT_IN_ORDER.get(b.key);
    if (aBuiltIn !== undefined || bBuiltIn !== undefined) {
      return (aBuiltIn ?? Infinity) - (bBuiltIn ?? Infinity);
    }
    return b.objectCount - a.objectCount || a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  });
}

// ---------------------------------------------------------------- buckets

// Thousands are always grouped ("9.470", not "9470" as Spanish formatting
// does by default for 4 digits), so figures line up with 5-digit ones in tables.
export function formatNumber(value: number): string {
  return value.toLocaleString("es", { maximumFractionDigits: 2, useGrouping: "always" });
}

/** The group a value falls in: dates by month, numbers by their rounded value, text as-is. */
export function bucketOf(kind: FieldKind, value: FieldValue): { key: string; label: string } {
  if (typeof value === "number") {
    const text = formatNumber(value);
    return { key: text, label: text };
  }
  if (kind === "date") {
    const month = value.slice(0, 7);
    return { key: month, label: monthLabel(month) };
  }
  return { key: value, label: value };
}

export interface BucketCount {
  key: string;
  label: string;
  objects: number;
}

/** Every distinct bucket of a field with its object count - months in date order, others largest first. */
export function bucketCounts(datasets: ModelDataset[], field: string, kind: FieldKind): BucketCount[] {
  const counts = new Map<string, BucketCount>();
  for (const dataset of datasets) {
    for (const rec of dataset.records) {
      const value = rec.values[field];
      if (value === undefined) continue;
      const bucket = bucketOf(kind, value);
      const entry = counts.get(bucket.key) ?? { ...bucket, objects: 0 };
      entry.objects++;
      counts.set(bucket.key, entry);
    }
  }
  const list = [...counts.values()];
  return kind === "date"
    ? list.sort((a, b) => a.key.localeCompare(b.key))
    : list.sort((a, b) => b.objects - a.objects || a.label.localeCompare(b.label, "es", { numeric: true }));
}

// ---------------------------------------------------------------- slicers

export interface SlicerSpec {
  field: string;
  kind: FieldKind;
  /** Bucket keys to keep; null means "all" (the slicer filters nothing). */
  selected: string[] | null;
}

/** Keeps only the objects whose values pass every restricting slicer. */
export function applySlicers(datasets: ModelDataset[], slicers: SlicerSpec[]): ModelDataset[] {
  const active = slicers
    .filter((s) => s.selected !== null)
    .map((s) => ({ field: s.field, kind: s.kind, keys: new Set(s.selected) }));
  if (active.length === 0) return datasets;
  return datasets.map((d) => ({
    ...d,
    records: d.records.filter((rec) =>
      active.every((s) => {
        const value = rec.values[s.field];
        return value !== undefined && s.keys.has(bucketOf(s.kind, value).key);
      })
    ),
  }));
}

// ---------------------------------------------------------------- charts

export interface AggregateSpec {
  /** Field whose values become the bars / slices. */
  category: string;
  categoryKind: FieldKind;
  /** Numeric field summed per category; null means "count the objects". */
  value: string | null;
}

export interface ChartRow {
  key: string;
  label: string;
  value: number;
  objects: number;
  members: Members;
}

export interface ChartResult {
  /** Every category: months in date order, others largest first. */
  rows: ChartRow[];
  /** Objects that had both the category and (if set) the value field. */
  objectsWithData: number;
  totalObjects: number;
}

function addMember(members: Members, modelId: string, runtimeId: number) {
  (members[modelId] ??= []).push(runtimeId);
}

export function mergeMembers(list: Members[]): Members {
  const merged: Members = {};
  for (const members of list) {
    for (const [modelId, ids] of Object.entries(members)) (merged[modelId] ??= []).push(...ids);
  }
  return merged;
}

export function aggregate(datasets: ModelDataset[], spec: AggregateSpec): ChartResult {
  const groups = new Map<string, ChartRow>();
  let totalObjects = 0;
  let objectsWithData = 0;

  for (const dataset of datasets) {
    for (const rec of dataset.records) {
      totalObjects++;
      const category = rec.values[spec.category];
      if (category === undefined) continue;
      let amount = 1;
      if (spec.value) {
        const measure = rec.values[spec.value];
        if (typeof measure !== "number") continue;
        amount = measure;
      }
      objectsWithData++;
      const bucket = bucketOf(spec.categoryKind, category);
      const row = groups.get(bucket.key) ?? { ...bucket, value: 0, objects: 0, members: {} };
      row.value += amount;
      row.objects++;
      addMember(row.members, dataset.modelId, rec.runtimeId);
      groups.set(bucket.key, row);
    }
  }

  const rows = [...groups.values()];
  if (spec.categoryKind === "date") rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es", { numeric: true }));
  return { rows, objectsWithData, totalObjects };
}

export interface CompareSpec extends AggregateSpec {
  /** Field that tells the two sides apart, e.g. a date (compared by month) or a phase. */
  compareBy: string;
  compareKind: FieldKind;
  periodA: string;
  periodB: string;
}

export interface CompareRow {
  key: string;
  label: string;
  a: number;
  b: number;
  objectsA: number;
  objectsB: number;
  membersA: Members;
  membersB: Members;
}

export interface CompareResult {
  rows: CompareRow[];
  objectsWithData: number;
  totalObjects: number;
}

/** Per category, the value of side A (objects in period A) next to side B. */
export function compare(datasets: ModelDataset[], spec: CompareSpec): CompareResult {
  const groups = new Map<string, CompareRow>();
  let totalObjects = 0;
  let objectsWithData = 0;

  for (const dataset of datasets) {
    for (const rec of dataset.records) {
      totalObjects++;
      const period = rec.values[spec.compareBy];
      const category = rec.values[spec.category];
      if (period === undefined || category === undefined) continue;
      const periodKey = bucketOf(spec.compareKind, period).key;
      const inA = periodKey === spec.periodA;
      const inB = periodKey === spec.periodB;
      if (!inA && !inB) continue;
      let amount = 1;
      if (spec.value) {
        const measure = rec.values[spec.value];
        if (typeof measure !== "number") continue;
        amount = measure;
      }
      objectsWithData++;
      const bucket = bucketOf(spec.categoryKind, category);
      const row = groups.get(bucket.key) ?? {
        ...bucket,
        a: 0,
        b: 0,
        objectsA: 0,
        objectsB: 0,
        membersA: {},
        membersB: {},
      };
      // A and B may be the same period: then the object counts on both sides.
      if (inA) {
        row.a += amount;
        row.objectsA++;
        addMember(row.membersA, dataset.modelId, rec.runtimeId);
      }
      if (inB) {
        row.b += amount;
        row.objectsB++;
        addMember(row.membersB, dataset.modelId, rec.runtimeId);
      }
      groups.set(bucket.key, row);
    }
  }

  const rows = [...groups.values()];
  if (spec.categoryKind === "date") rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((x, y) => y.a + y.b - (x.a + x.b) || x.label.localeCompare(y.label, "es", { numeric: true }));
  return { rows, objectsWithData, totalObjects };
}

// ---------------------------------------------------------------- folding

export const OTHER_KEY = "__otros__";
export const OTHER_LABEL = "Otros";
const OLDER_LABEL = "Anteriores";

/**
 * Keeps `max - 1` rows and folds the rest into one: the smallest ones into
 * "Otros", or - for months in date order - the oldest into "Anteriores".
 */
function fold<T extends { key: string; label: string }>(
  rows: T[],
  max: number,
  chronological: boolean,
  merge: (rest: T[]) => Omit<T, "key" | "label">
): T[] {
  if (rows.length <= max) return rows;
  if (chronological) {
    const rest = rows.slice(0, rows.length - (max - 1));
    return [{ key: OTHER_KEY, label: OLDER_LABEL, ...merge(rest) } as T, ...rows.slice(rows.length - (max - 1))];
  }
  const rest = rows.slice(max - 1);
  return [...rows.slice(0, max - 1), { key: OTHER_KEY, label: OTHER_LABEL, ...merge(rest) } as T];
}

export function foldRows(rows: ChartRow[], max: number, chronological = false): ChartRow[] {
  return fold(rows, max, chronological, (rest) => ({
    value: rest.reduce((sum, r) => sum + r.value, 0),
    objects: rest.reduce((sum, r) => sum + r.objects, 0),
    members: mergeMembers(rest.map((r) => r.members)),
  }));
}

export function foldCompareRows(rows: CompareRow[], max: number, chronological = false): CompareRow[] {
  return fold(rows, max, chronological, (rest) => ({
    a: rest.reduce((sum, r) => sum + r.a, 0),
    b: rest.reduce((sum, r) => sum + r.b, 0),
    objectsA: rest.reduce((sum, r) => sum + r.objectsA, 0),
    objectsB: rest.reduce((sum, r) => sum + r.objectsB, 0),
    membersA: mergeMembers(rest.map((r) => r.membersA)),
    membersB: mergeMembers(rest.map((r) => r.membersB)),
  }));
}

export function memberCount(members: Members): number {
  return Object.values(members).reduce((sum, ids) => sum + ids.length, 0);
}
