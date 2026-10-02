// "Seleccionar por agrupación": groups the objects of the loaded models by one
// or more fields - native properties of the model or attributes of this app -
// so a whole group can be selected in the 3D viewer at once.
import { Field, FieldKind, FieldValue, formatNumber, GENERAL_GROUP, Members, ModelDataset } from "../graficos/modelData";
import { isoToDisplay } from "./values";

export const MAX_GROUP_FIELDS = 3;
export const NO_VALUE = "(Sin valor)";
/** Fields that come from this app's attribute catalog (see lib/graficos/propiedades.ts). */
export const APP_FIELD_PREFIX = "prop:";

export interface GroupField extends Field {
  /** Objects (across the given models) that have a value for it. */
  objectCount: number;
  /** An attribute of the project catalog rather than a property of the model. */
  fromApp: boolean;
}

/**
 * Every field of the given models - not only the ones they share: an element
 * without the field simply groups as "(Sin valor)". The project's attributes
 * come first, then the general ones (class, name, type, model), then each
 * property set by name. A field whose kind differs between models is text.
 */
export function availableFields(datasets: ModelDataset[]): GroupField[] {
  const out = new Map<string, GroupField>();
  for (const dataset of datasets) {
    for (const [key, field] of dataset.fields) {
      const count = dataset.coverage.get(key) ?? 0;
      const known = out.get(key);
      if (!known) {
        out.set(key, { ...field, objectCount: count, fromApp: key.startsWith(APP_FIELD_PREFIX) });
      } else {
        known.objectCount += count;
        if (known.kind !== field.kind) {
          known.kind = "text";
          known.unit = undefined;
        }
      }
    }
  }
  const rank = (f: GroupField) => (f.fromApp ? 0 : f.group === GENERAL_GROUP ? 1 : 2);
  return [...out.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) !== 1 ? a.group.localeCompare(b.group, "es", { sensitivity: "base" }) : 0) ||
      a.label.localeCompare(b.label, "es", { sensitivity: "base", numeric: true })
  );
}

/** How a value reads in a group's name: numbers grouped by thousands, dates DD-MM-AAAA. */
export function valueLabel(kind: FieldKind, value: FieldValue): string {
  if (typeof value === "number") return formatNumber(value);
  if (kind === "date" || /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const day = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return isoToDisplay(day);
  }
  return value;
}

export interface GroupRow {
  /** Identifies the combination of values. */
  key: string;
  /** One label per grouping field, "(Sin valor)" where the element has none. */
  labels: string[];
  objects: number;
  /** Runtime ids per model, ready for the viewer selection. */
  members: Members;
}

type SortValue = number | string | null;

function compareSortValues(a: SortValue[], b: SortValue[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === null) return 1; // "(Sin valor)" last
    if (y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    const diff = String(x).localeCompare(String(y), "es", { sensitivity: "base", numeric: true });
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Groups every object by its values of `fields` (in that order). Groups are
 * sorted level by level: numbers and dates in order, text alphabetically
 * (with numbers inside text in numeric order: "Piso 2" before "Piso 10"),
 * and "(Sin valor)" last.
 */
export function groupObjects(datasets: ModelDataset[], fields: Pick<Field, "key" | "kind">[]): GroupRow[] {
  if (fields.length === 0) return [];
  const groups = new Map<string, GroupRow & { sort: SortValue[] }>();
  for (const dataset of datasets) {
    for (const record of dataset.records) {
      const labels: string[] = [];
      const sort: SortValue[] = [];
      for (const field of fields) {
        const value = record.values[field.key];
        if (value === undefined) {
          labels.push(NO_VALUE);
          sort.push(null);
        } else {
          labels.push(valueLabel(field.kind, value));
          sort.push(value); // ISO dates sort in date order as text
        }
      }
      const key = JSON.stringify(labels);
      let group = groups.get(key);
      if (!group) {
        group = { key, labels, objects: 0, members: {}, sort };
        groups.set(key, group);
      }
      group.objects++;
      (group.members[dataset.modelId] ??= []).push(record.runtimeId);
    }
  }
  return [...groups.values()]
    .sort((a, b) => compareSortValues(a.sort, b.sort))
    .map(({ sort: _sort, ...row }) => row);
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Groups whose name contains every word typed (accents and case ignored). */
export function filterGroups(rows: GroupRow[], query: string): GroupRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const text = fold(row.labels.join(" "));
    return words.every((w) => text.includes(w));
  });
}

/** Fields that match the search, for the "agrupar por" picker. */
export function filterFields(fields: GroupField[], query: string): GroupField[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return fields;
  return fields.filter((f) => {
    const text = fold(`${f.group} ${f.label}`);
    return words.every((w) => text.includes(w));
  });
}

/** A saved configuration's fields, matched against what the loaded models have now. */
export function resolveSavedFields(
  saved: { key: string; label: string }[],
  available: GroupField[]
): { found: GroupField[]; missing: string[] } {
  const byKey = new Map(available.map((f) => [f.key, f]));
  const found: GroupField[] = [];
  const missing: string[] = [];
  for (const s of saved) {
    const field = byKey.get(s.key);
    if (field) found.push(field);
    else missing.push(s.label);
  }
  return { found, missing };
}

/** Total objects of several groups (each object belongs to one group). */
export function countObjects(rows: GroupRow[]): number {
  return rows.reduce((sum, r) => sum + r.objects, 0);
}
