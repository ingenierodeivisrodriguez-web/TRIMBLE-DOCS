import { AttributeDefinition, AttributeValue, DEFAULT_GROUP, StoredValue, ValueChange } from "./types";
import { formatValue } from "./values";

/** What the selected elements have for one attribute. */
export type FieldSummary =
  | { kind: "empty" }
  | { kind: "same"; value: AttributeValue; updatedAt: string; updatedBy: string | null }
  /** They differ (including some having a value and others not). */
  | { kind: "mixed"; withValue: number; distinct: number };

/**
 * Summarizes the stored values of every attribute across the selected
 * elements. An element without a value counts as different from one with a
 * value, so "3 have it, 2 don't" is mixed too.
 */
export function summarizeValues(guids: string[], values: StoredValue[]): Map<string, FieldSummary> {
  const selected = new Set(guids);
  const unique = [...selected];
  const byAttribute = new Map<string, Map<string, StoredValue>>();
  for (const v of values) {
    if (!selected.has(v.ifcGuid)) continue;
    const perGuid = byAttribute.get(v.attributeId) ?? new Map<string, StoredValue>();
    perGuid.set(v.ifcGuid, v);
    byAttribute.set(v.attributeId, perGuid);
  }

  const summaries = new Map<string, FieldSummary>();
  for (const [attributeId, perGuid] of byAttribute) {
    const present = unique.map((g) => perGuid.get(g)).filter((v): v is StoredValue => !!v);
    const distinct = new Set(present.map((v) => JSON.stringify(v.value))).size;
    if (present.length === unique.length && distinct === 1) {
      const latest = present.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
      summaries.set(attributeId, { kind: "same", value: present[0].value, updatedAt: latest.updatedAt, updatedBy: latest.updatedBy });
    } else {
      summaries.set(attributeId, { kind: "mixed", withValue: present.length, distinct });
    }
  }
  return summaries;
}

export function summaryOf(summaries: Map<string, FieldSummary>, attributeId: string): FieldSummary {
  return summaries.get(attributeId) ?? { kind: "empty" };
}

/**
 * Turns the user's edits (attribute id -> new value, null = clear) into the
 * changes to save. Only edited fields are saved, so a field left showing
 * "Valores mixtos" is never written; an edit that leaves the field as it was
 * is dropped too.
 */
export function pendingChanges(
  edits: Map<string, AttributeValue | null>,
  summaries: Map<string, FieldSummary>
): ValueChange[] {
  const changes: ValueChange[] = [];
  for (const [attributeId, value] of edits) {
    const current = summaryOf(summaries, attributeId);
    if (value === null && current.kind === "empty") continue;
    if (value !== null && current.kind === "same" && current.value === value) continue;
    changes.push({ attributeId, value });
  }
  return changes;
}

export interface Consequence {
  title: string;
  /** What saving will do to values that already differ or exist. */
  detail: string;
}

/**
 * The parts of a save the user has to confirm explicitly: replacing values
 * that differ between the selected elements, and clearing existing values.
 */
export function consequences(
  changes: ValueChange[],
  summaries: Map<string, FieldSummary>,
  definitions: AttributeDefinition[],
  elementCount: number
): Consequence[] {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const out: Consequence[] = [];
  for (const change of changes) {
    const def = byId.get(change.attributeId);
    if (!def) continue;
    const current = summaryOf(summaries, change.attributeId);
    if (current.kind === "mixed") {
      out.push({
        title: def.title,
        detail:
          change.value === null
            ? `tenía valores distintos; se borrará en los ${elementCount} elementos`
            : `tenía valores distintos; todos los ${elementCount} elementos quedarán con "${formatValue(def.dataType, change.value)}"`,
      });
    } else if (change.value === null && current.kind === "same") {
      out.push({ title: def.title, detail: `se borrará el valor "${formatValue(def.dataType, current.value)}"` });
    }
  }
  return out;
}

export interface DefinitionGroup {
  name: string;
  attributes: AttributeDefinition[];
}

/**
 * Groups definitions for display: groups in the order of their first attribute
 * (lowest display order), attributes by display order, then title.
 */
export function groupDefinitions(definitions: AttributeDefinition[]): DefinitionGroup[] {
  const sorted = [...definitions].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es", { sensitivity: "base" })
  );
  const groups = new Map<string, AttributeDefinition[]>();
  for (const def of sorted) {
    const name = def.group.trim() || DEFAULT_GROUP;
    const list = groups.get(name) ?? [];
    list.push(def);
    groups.set(name, list);
  }
  return [...groups].map(([name, attributes]) => ({ name, attributes }));
}

/** Distinct group names already in use, for the "pick an existing group" list. */
export function existingGroups(definitions: AttributeDefinition[]): string[] {
  return [...new Set(definitions.map((d) => d.group.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}
