import type { AttributeDefinition, ProjectContacts, Responsable } from "./types";

export function responsableKey(r: Pick<Responsable, "type" | "id">): string {
  return `${r.type}:${r.id}`;
}

function sameList(a: Responsable[], b: Responsable[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(responsableKey));
  return b.every((r) => keys.has(responsableKey(r)));
}

/** The responsables every given attribute shares: what applies to their whole group. */
export function commonResponsables(definitions: AttributeDefinition[]): Responsable[] {
  if (definitions.length === 0) return [];
  const [first, ...rest] = definitions;
  return first.responsables.filter((r) =>
    rest.every((d) => d.responsables.some((o) => responsableKey(o) === responsableKey(r)))
  );
}

/**
 * Applies a group-level change of responsables, from `before` (what the group
 * had in common) to `after`: the ones taken out leave every attribute, the new
 * ones join every attribute, and those assigned to a single attribute stay.
 * Returns only the attributes whose list changes.
 */
export function applyGroupResponsables(
  definitions: AttributeDefinition[],
  before: Responsable[],
  after: Responsable[]
): { id: string; responsables: Responsable[] }[] {
  const afterKeys = new Set(after.map(responsableKey));
  const removed = new Set(before.filter((r) => !afterKeys.has(responsableKey(r))).map(responsableKey));
  const out: { id: string; responsables: Responsable[] }[] = [];
  for (const def of definitions) {
    const kept = def.responsables.filter((r) => !removed.has(responsableKey(r)));
    const keptKeys = new Set(kept.map(responsableKey));
    const next = [...kept, ...after.filter((r) => !keptKeys.has(responsableKey(r)))];
    if (!sameList(next, def.responsables)) out.push({ id: def.id, responsables: next });
  }
  return out;
}

/** People and groups can be renamed in Trimble Connect: show the current name when the contact list is at hand. */
export function withCurrentNames(list: Responsable[], contacts: ProjectContacts | null): Responsable[] {
  if (!contacts) return list;
  const names = new Map<string, string>();
  for (const u of contacts.users) names.set(responsableKey({ type: "user", id: u.id }), u.name);
  for (const g of contacts.groups) names.set(responsableKey({ type: "group", id: g.id }), g.name);
  return list.map((r) => ({ ...r, name: names.get(responsableKey(r)) ?? r.name }));
}

/** "David Pérez y el grupo Calidad", for read-only notes. */
export function describeResponsables(list: Responsable[]): string {
  const names = list.map((r) => (r.type === "group" ? `el grupo ${r.name}` : r.name));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}
