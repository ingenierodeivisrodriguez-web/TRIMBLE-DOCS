// Joins Trimble Connect property-set library values (e.g. "control
// construccion · está construido") onto the objects read from the viewer, so
// they chart, filter and color like any property of the model itself.
import type { LibrariesPayload, PsetDefinition, PsetInstance } from "../psetApi";
import { Field, FieldKind, FieldValue, ModelDataset, parseDateText } from "./modelData";

export type { LibrariesPayload };

/** How the Trimble property panel addresses a model object: its IFC GUID, URL-encoded. */
export function entityLink(guid: string): string {
  return `frn:entity:${encodeURIComponent(guid)}`;
}

/** The object GUID at the end of an frn link (the last ":"-separated part, URL-decoded). */
export function guidFromLink(link: string): string | null {
  const last = link.slice(link.lastIndexOf(":") + 1);
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

const LANGS = ["es", "en"];

function translated(def: PsetDefinition, pick: (t: { name?: string; props?: Record<string, string> }) => string | undefined): string | undefined {
  const langs = [...LANGS, ...Object.keys(def.i18n ?? {})];
  for (const lang of langs) {
    const value = def.i18n?.[lang] ? pick(def.i18n[lang]) : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function definitionLabel(def: PsetDefinition): string {
  return translated(def, (t) => t.name) ?? def.name;
}

export function propertyLabel(def: PsetDefinition, key: string): string {
  return translated(def, (t) => t.props?.[key]) ?? def.props[key]?.title ?? key;
}

function kindOf(schema: PsetDefinition["props"][string] | undefined): FieldKind {
  const type = schema?.type;
  if (type === "number" || type === "integer") return "number";
  if (type === "string" && (schema?.format === "date" || schema?.format === "date-time")) return "date";
  return "text";
}

const TRUE_WORDS = new Set(["true", "verdadero", "si", "sí", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "falso", "no", "0"]);

/** A pset value as the charts store it: booleans become Sí / No, dates ISO, numbers numbers. */
export function convertPsetValue(
  schema: PsetDefinition["props"][string] | undefined,
  value: unknown
): { kind: FieldKind; value: FieldValue } | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return { kind: "text", value: value ? "Sí" : "No" };
  if (schema?.type === "boolean") {
    const word = String(value).trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return { kind: "text", value: "Sí" };
    if (FALSE_WORDS.has(word)) return { kind: "text", value: "No" };
  }
  const kind = kindOf(schema);
  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? { kind, value: n } : null;
  }
  if (kind === "date") {
    const text = String(value).trim();
    const iso = parseDateText(text) ?? parseDateText(text.slice(0, 10));
    return iso ? { kind, value: iso } : { kind: "text", value: text };
  }
  if (Array.isArray(value)) {
    const joined = value.map(String).join(", ").trim();
    return joined ? { kind: "text", value: joined } : null;
  }
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text ? { kind: "text", value: text } : null;
}

export function psetFieldKey(libId: string, defId: string, prop: string): string {
  return `pset:${libId}/${defId}/${prop}`;
}

/** Summary of what a set of libraries adds, for the status line. */
export function librarySummary(data: LibrariesPayload): { name: string; objects: number }[] {
  return data.libs.map((lib) => ({
    name: lib.name,
    objects: new Set(data.psets.filter((p) => p.libId === lib.id).map((p) => guidFromLink(p.link))).size,
  }));
}

/**
 * Adds every library property to the datasets as a field (in every model, so
 * a library field is always offered even if only some models have values)
 * and fills in each object's values, matched by its GUID. Records without
 * library values are reused as-is.
 */
export function mergePsets(
  datasets: ModelDataset[],
  guidMaps: Record<string, Map<number, string>>,
  data: LibrariesPayload
): ModelDataset[] {
  const defs = new Map(data.defs.map((d) => [`${d.libId}/${d.id}`, d]));

  const fields: Field[] = [];
  for (const def of data.defs) {
    const group = definitionLabel(def);
    for (const [prop, schema] of Object.entries(def.props)) {
      fields.push({
        key: psetFieldKey(def.libId, def.id, prop),
        label: propertyLabel(def, prop),
        group,
        kind: kindOf(schema),
      });
    }
  }

  const byGuid = new Map<string, PsetInstance[]>();
  for (const pset of data.psets) {
    const guid = guidFromLink(pset.link);
    if (!guid) continue;
    const list = byGuid.get(guid) ?? [];
    list.push(pset);
    byGuid.set(guid, list);
  }

  return datasets.map((dataset) => {
    const guids = guidMaps[dataset.modelId];
    const fieldMap = new Map(dataset.fields);
    const coverage = new Map(dataset.coverage);
    for (const field of fields) {
      if (!fieldMap.has(field.key)) fieldMap.set(field.key, field);
    }
    if (!guids) return { ...dataset, fields: fieldMap, coverage };

    const records = dataset.records.map((rec) => {
      const guid = guids.get(rec.runtimeId);
      const psets = guid ? byGuid.get(guid) : undefined;
      if (!psets) return rec;
      const values = { ...rec.values };
      for (const pset of psets) {
        const def = defs.get(`${pset.libId}/${pset.defId}`);
        if (!def) continue;
        for (const [prop, raw] of Object.entries(pset.props)) {
          const converted = convertPsetValue(def.props[prop], raw);
          if (!converted) continue;
          const key = psetFieldKey(def.libId, def.id, prop);
          if (!fieldMap.has(key)) {
            // A value for a property the definition no longer lists (open pset).
            fieldMap.set(key, { key, label: propertyLabel(def, prop), group: definitionLabel(def), kind: converted.kind });
          } else if (fieldMap.get(key)!.kind !== converted.kind) {
            fieldMap.set(key, { ...fieldMap.get(key)!, kind: "text" });
          }
          values[key] = converted.value;
          coverage.set(key, (coverage.get(key) ?? 0) + 1);
        }
      }
      return { ...rec, values };
    });
    return { ...dataset, records, fields: fieldMap, coverage };
  });
}
