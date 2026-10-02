// Joins the attributes of the "Propiedades" app (a project catalog of
// attributes whose values are assigned to model elements by IFCGUID, stored
// in Supabase) onto the objects read from the viewer, so they chart, filter
// and color like any property of the model itself.
import { normalizeGuid } from "../propiedades/ifcGuid";
import type { DataType } from "../propiedades/types";
import { Field, FieldKind, FieldValue, ModelDataset, ObjectRecord } from "./modelData";

/** An attribute of the project's catalog, as Gráficos needs it. */
export interface PropiedadesDefinition {
  id: string;
  title: string;
  dataType: DataType;
  group: string;
  sortOrder: number;
  active: boolean;
}

/** A value assigned to an element (dates as ISO "YYYY-MM-DD"). */
export interface PropiedadesValue {
  ifcGuid: string;
  attributeId: string;
  value: string | number | boolean;
}

/** One page of /api/graficos/propiedades; the catalog comes with the first page. */
export interface PropiedadesPage {
  definitions?: PropiedadesDefinition[];
  values: PropiedadesValue[];
  total: number;
  /** Offset of the following page, null on the last one. */
  next: number | null;
}

export interface PropiedadesData {
  definitions: PropiedadesDefinition[];
  values: PropiedadesValue[];
}

export function propiedadFieldKey(attributeId: string): string {
  return `prop:${attributeId}`;
}

function kindOf(dataType: DataType): FieldKind {
  return dataType === "number" ? "number" : dataType === "date" ? "date" : "text";
}

/** A stored value as the charts use it: Sí / No for yes-no, ISO dates, numbers as numbers. */
export function convertPropiedadValue(dataType: DataType, value: unknown): FieldValue | null {
  if (value === null || value === undefined || value === "") return null;
  switch (dataType) {
    case "boolean":
      if (typeof value === "boolean") return value ? "Sí" : "No";
      return String(value).toLowerCase() === "true" ? "Sí" : String(value).toLowerCase() === "false" ? "No" : null;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "date": {
      const iso = String(value).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
    }
    default: {
      const text = String(value).trim();
      return text || null;
    }
  }
}

/**
 * The element's IFCGUID exactly as the Propiedades panel resolves it: an
 * explicit GUID property of the object (e.g. Revit's "IfcGUID") first, else
 * the viewer's external id converted to the 22-character IFC form.
 */
export function elementIfcGuid(record: ObjectRecord, externalIds: Map<number, string> | undefined): string | null {
  return record.ifcGuid ?? normalizeGuid(externalIds?.get(record.runtimeId));
}

/**
 * Adds every attribute of the catalog to the datasets as a field (in every
 * model, so it is always offered, even before any element has a value) and
 * fills in each object's values, matched by IFCGUID. Inactive attributes are
 * kept only if some element still has a value. Records without values are reused as-is.
 */
export function mergePropiedades(
  datasets: ModelDataset[],
  guidMaps: Record<string, Map<number, string>>,
  data: PropiedadesData
): ModelDataset[] {
  const withValues = new Set(data.values.map((v) => v.attributeId));
  const definitions = new Map(
    data.definitions.filter((d) => d.active || withValues.has(d.id)).map((d) => [d.id, d])
  );
  const fields: Field[] = [...definitions.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es"))
    .map((d) => ({ key: propiedadFieldKey(d.id), label: d.title, group: d.group, kind: kindOf(d.dataType) }));

  const byGuid = new Map<string, PropiedadesValue[]>();
  for (const value of data.values) {
    if (!definitions.has(value.attributeId)) continue;
    const list = byGuid.get(value.ifcGuid) ?? [];
    list.push(value);
    byGuid.set(value.ifcGuid, list);
  }

  return datasets.map((dataset) => {
    const fieldMap = new Map(dataset.fields);
    const coverage = new Map(dataset.coverage);
    for (const field of fields) if (!fieldMap.has(field.key)) fieldMap.set(field.key, field);
    if (byGuid.size === 0) return { ...dataset, fields: fieldMap, coverage };

    const externalIds = guidMaps[dataset.modelId];
    const records = dataset.records.map((rec) => {
      const guid = elementIfcGuid(rec, externalIds);
      const assigned = guid ? byGuid.get(guid) : undefined;
      if (!assigned) return rec;
      const values = { ...rec.values };
      for (const item of assigned) {
        const converted = convertPropiedadValue(definitions.get(item.attributeId)!.dataType, item.value);
        if (converted === null) continue;
        const key = propiedadFieldKey(item.attributeId);
        values[key] = converted;
        coverage.set(key, (coverage.get(key) ?? 0) + 1);
      }
      return { ...rec, values };
    });
    return { ...dataset, records, fields: fieldMap, coverage };
  });
}

/** Objects of the datasets that got at least one Propiedades value. */
export function propiedadesMatches(datasets: ModelDataset[]): number {
  let count = 0;
  for (const d of datasets) for (const r of d.records) if (Object.keys(r.values).some((k) => k.startsWith("prop:"))) count++;
  return count;
}
