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

export type FieldKind = "number" | "text";

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

export const GENERAL_GROUP = "General";

const BUILT_IN_FIELDS: Field[] = [
  { key: "@model", label: "Modelo", group: GENERAL_GROUP, kind: "text" },
  { key: "@class", label: "Clase", group: GENERAL_GROUP, kind: "text" },
  { key: "@name", label: "Nombre", group: GENERAL_GROUP, kind: "text" },
  { key: "@objectType", label: "Tipo", group: GENERAL_GROUP, kind: "text" },
];
const BUILT_IN_ORDER = new Map(BUILT_IN_FIELDS.map((f, i) => [f.key, i]));

function convert(type: number, value: unknown): { kind: FieldKind; value: FieldValue } | null {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC_TYPES.has(type)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return { kind: "number", value: type === TYPE.Length ? n / 1000 : n };
  }
  if (type === TYPE.Logical || type === TYPE.Boolean) {
    const truthy = value === true || value === 1 || value === "1" || value === "true";
    return { kind: "text", value: truthy ? "Sí" : "No" };
  }
  const text = String(value).trim();
  return text ? { kind: "text", value: text } : null;
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

export interface CommonField extends Field {
  /** Objects (across all given models) that carry this field. */
  objectCount: number;
}

/**
 * Fields present in every given model (in at least one object each). A field
 * that is numeric in one model and text in another is offered as text.
 * Built-ins come first, then the most widespread fields.
 */
export function commonFields(datasets: ModelDataset[]): CommonField[] {
  if (datasets.length === 0) return [];
  const [first, ...rest] = datasets;
  const result: CommonField[] = [];

  for (const [key, field] of first.fields) {
    if (!rest.every((d) => d.fields.has(key))) continue;
    const allNumeric = datasets.every((d) => d.fields.get(key)!.kind === "number");
    result.push({
      ...field,
      kind: allNumeric ? "number" : "text",
      unit: allNumeric ? field.unit : undefined,
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

export interface ChartSpec {
  /** Field whose values become the bars / slices. */
  category: string | null;
  /** Numeric field summed per category; null means "count the objects". */
  value: string | null;
}

export interface ChartRow {
  label: string;
  value: number;
  objects: number;
}

export interface ChartResult {
  /** Every category, largest first. */
  rows: ChartRow[];
  /** Objects that had both the category and (if set) the value field. */
  objectsWithData: number;
  totalObjects: number;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("es", { maximumFractionDigits: 2 });
}

export function aggregate(datasets: ModelDataset[], spec: ChartSpec): ChartResult | null {
  if (!spec.category) return null;
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
      const label = typeof category === "number" ? formatNumber(category) : category;
      const row = groups.get(label) ?? { label, value: 0, objects: 0 };
      row.value += amount;
      row.objects++;
      groups.set(label, row);
    }
  }

  const rows = [...groups.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label, "es", { numeric: true })
  );
  return { rows, objectsWithData, totalObjects };
}

export const OTHER_LABEL = "Otros";

/** Keeps the `max - 1` largest rows and folds the rest into a single "Otros" row. */
export function foldRows(rows: ChartRow[], max: number): ChartRow[] {
  if (rows.length <= max) return rows;
  const kept = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1);
  return [
    ...kept,
    {
      label: OTHER_LABEL,
      value: rest.reduce((sum, r) => sum + r.value, 0),
      objects: rest.reduce((sum, r) => sum + r.objects, 0),
    },
  ];
}
