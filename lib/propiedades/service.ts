import { isIfcGuid } from "./ifcGuid";
import type { PropertiesStore } from "./store";
import {
  AttributeDefinition,
  CatalogResponse,
  DATA_TYPES,
  DataType,
  DEFAULT_GROUP,
  DefinitionInput,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_GROUP_LENGTH,
  MAX_GROUPING_FIELDS,
  MAX_GROUPING_NAME_LENGTH,
  MAX_SAVED_GROUPINGS,
  MAX_RESPONSABLES,
  MAX_TITLE_LENGTH,
  ProjectContacts,
  Responsable,
  SavedGrouping,
  SavedGroupingField,
  StoredValue,
  TargetElement,
  ValueChange,
} from "./types";
import { validateValue } from "./values";

/** Who is calling, as resolved from their Trimble Connect token. */
export interface Caller {
  id: string;
  name: string;
  /** Project administrators are the only ones who can change the catalog. */
  isAdmin: boolean;
  /** Which of these Trimble Connect groups the caller belongs to (asked only when needed). */
  memberOfGroups?: (groupIds: string[]) => Promise<Set<string>>;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAdmin(caller: Caller) {
  if (!caller.isAdmin) {
    throw new ServiceError("Solo un administrador del proyecto puede modificar el catálogo de atributos.", 403, "not-admin");
  }
}

function requireDefinitionId(id: string) {
  if (!UUID_RE.test(id)) throw new ServiceError("El identificador del atributo no es válido.", 400);
}

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ServiceError(`Falta ${field}.`, 400);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ServiceError(`${field} no puede superar ${max} caracteres.`, 400);
  return text;
}

const CONTACT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** People or groups of the project; repeated ones are dropped. */
function readResponsables(value: unknown): Responsable[] {
  if (!Array.isArray(value)) throw new ServiceError("Los responsables deben ser una lista.", 400);
  if (value.length > MAX_RESPONSABLES) throw new ServiceError(`Se pueden asignar hasta ${MAX_RESPONSABLES} responsables.`, 400);
  const out = new Map<string, Responsable>();
  for (const raw of value) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if ((r.type !== "user" && r.type !== "group") || typeof r.id !== "string" || !CONTACT_ID_RE.test(r.id)) {
      throw new ServiceError("Uno de los responsables no es una persona o grupo válido del proyecto.", 400);
    }
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 160) : r.id;
    out.set(`${r.type}:${r.id}`, { type: r.type, id: r.id, name });
  }
  return [...out.values()];
}

function readDefinitionInput(body: unknown, partial: boolean): Partial<DefinitionInput> & { active?: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<DefinitionInput> & { active?: boolean } = {};
  if (!partial || b.title !== undefined) out.title = cleanText(b.title, "el título", MAX_TITLE_LENGTH);
  if (!partial || b.dataType !== undefined) {
    if (!DATA_TYPES.includes(b.dataType as DataType)) {
      throw new ServiceError("El tipo de dato debe ser texto, número, sí/no o fecha.", 400);
    }
    out.dataType = b.dataType as DataType;
  }
  if (!partial || b.group !== undefined) {
    out.group = typeof b.group === "string" && b.group.trim() ? cleanText(b.group, "el grupo", MAX_GROUP_LENGTH) : DEFAULT_GROUP;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== "number" || !Number.isInteger(b.sortOrder) || Math.abs(b.sortOrder) > 1_000_000) {
      throw new ServiceError("El orden debe ser un número entero.", 400);
    }
    out.sortOrder = b.sortOrder;
  }
  if (b.responsables !== undefined) out.responsables = readResponsables(b.responsables);
  if (partial && b.active !== undefined) {
    if (typeof b.active !== "boolean") throw new ServiceError("El estado activo debe ser sí o no.", 400);
    out.active = b.active;
  }
  return out;
}

function assertUniqueTitle(definitions: AttributeDefinition[], title: string, exceptId?: string) {
  const clash = definitions.find(
    (d) => d.id !== exceptId && d.title.localeCompare(title, "es", { sensitivity: "base" }) === 0
  );
  if (clash) {
    throw new ServiceError(
      `Ya existe un atributo llamado "${clash.title}"${clash.active ? "" : " (inactivo: puedes reactivarlo)"}.`,
      409,
      "duplicate-title"
    );
  }
}

// ---------------------------------------------------------------- catalog

/**
 * The attributes whose values the caller can assign: every one for project
 * administrators; otherwise those that name them, or a group they belong to,
 * as responsables. An attribute without responsables is for administrators only.
 */
export async function editableAttributeIds(caller: Caller, definitions: AttributeDefinition[]): Promise<Set<string>> {
  if (caller.isAdmin) return new Set(definitions.map((d) => d.id));
  const editable = new Set(
    definitions.filter((d) => d.responsables.some((r) => r.type === "user" && r.id === caller.id)).map((d) => d.id)
  );
  const groupIds = [
    ...new Set(
      definitions
        .filter((d) => !editable.has(d.id))
        .flatMap((d) => d.responsables.filter((r) => r.type === "group").map((r) => r.id))
    ),
  ];
  if (groupIds.length && caller.memberOfGroups) {
    const mine = await caller.memberOfGroups(groupIds);
    for (const d of definitions) if (d.responsables.some((r) => r.type === "group" && mine.has(r.id))) editable.add(d.id);
  }
  return editable;
}

export async function getCatalog(store: PropertiesStore, caller: Caller, projectId: string): Promise<CatalogResponse> {
  const definitions = await store.listDefinitions(projectId);
  const editable = await editableAttributeIds(caller, definitions.filter((d) => d.active));
  return { definitions, canEdit: caller.isAdmin, editableIds: [...editable] };
}

/** The project's people and groups, to choose responsables from (administrators only). */
export async function listContacts(caller: Caller, load: () => Promise<ProjectContacts>): Promise<ProjectContacts> {
  requireAdmin(caller);
  return load();
}

export async function createDefinition(
  store: PropertiesStore,
  caller: Caller,
  projectId: string,
  body: unknown
): Promise<AttributeDefinition> {
  requireAdmin(caller);
  const input = readDefinitionInput(body, false) as DefinitionInput;
  const existing = await store.listDefinitions(projectId);
  assertUniqueTitle(existing, input.title);
  if (input.sortOrder === undefined) {
    input.sortOrder = existing.reduce((max, d) => Math.max(max, d.sortOrder), 0) + 10;
  }
  return store.insertDefinition(projectId, input, caller.name);
}

export async function updateDefinition(
  store: PropertiesStore,
  caller: Caller,
  projectId: string,
  id: string,
  body: unknown
): Promise<AttributeDefinition> {
  requireAdmin(caller);
  requireDefinitionId(id);
  const patch = readDefinitionInput(body, true);
  const current = await store.getDefinition(projectId, id);
  if (!current) throw new ServiceError("El atributo no existe en este proyecto.", 404);
  if (patch.title !== undefined) assertUniqueTitle(await store.listDefinitions(projectId), patch.title, id);
  if (patch.dataType !== undefined && patch.dataType !== current.dataType && current.valueCount > 0) {
    throw new ServiceError(
      `No se puede cambiar el tipo de "${current.title}": ya tiene ${current.valueCount} valores guardados con el tipo actual.`,
      409,
      "type-locked"
    );
  }
  const updated = await store.updateDefinition(projectId, id, patch, caller.name);
  if (!updated) throw new ServiceError("El atributo no existe en este proyecto.", 404);
  return updated;
}

/**
 * Deletes a definition only while nothing references it. Once it has values
 * it can only be deactivated, so the values stay and remain queryable.
 */
export async function deleteDefinition(
  store: PropertiesStore,
  caller: Caller,
  projectId: string,
  id: string
): Promise<void> {
  requireAdmin(caller);
  requireDefinitionId(id);
  const result = await store.deleteDefinition(projectId, id);
  if (result === "not-found") throw new ServiceError("El atributo no existe en este proyecto.", 404);
  if (result === "has-values") {
    throw new ServiceError(
      "Este atributo ya tiene valores asignados, así que no se puede eliminar: desactívalo para que deje de usarse sin perder esos valores.",
      409,
      "has-values"
    );
  }
}

// ---------------------------------------------------------------- values

function readGuids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ServiceError("Falta la lista de IFCGUID.", 400);
  if (value.length > MAX_ELEMENTS_PER_REQUEST) {
    throw new ServiceError(`Se pueden consultar hasta ${MAX_ELEMENTS_PER_REQUEST} elementos por solicitud.`, 400);
  }
  const guids = value.map(String);
  const bad = guids.find((g) => !isIfcGuid(g));
  if (bad) throw new ServiceError(`"${bad.slice(0, 40)}" no es un IFCGUID válido (22 caracteres).`, 400);
  return [...new Set(guids)];
}

export async function queryValues(store: PropertiesStore, projectId: string, body: unknown): Promise<StoredValue[]> {
  const guids = readGuids((body as { ifcGuids?: unknown } | null)?.ifcGuids);
  return store.getValues(projectId, guids);
}

/**
 * Upserts the given attribute values on every element (null clears a value).
 * Every change is checked against the catalog first: unknown or inactive
 * attributes and values of the wrong type are rejected before anything is written.
 */
export async function saveValues(
  store: PropertiesStore,
  caller: Caller,
  projectId: string,
  body: unknown
): Promise<{ elements: number; attributes: number }> {
  const b = (body ?? {}) as { elements?: unknown; changes?: unknown };
  if (!Array.isArray(b.elements) || b.elements.length === 0) throw new ServiceError("No hay elementos a los que asignar valores.", 400);
  if (b.elements.length > MAX_ELEMENTS_PER_REQUEST) {
    throw new ServiceError(`Se pueden guardar hasta ${MAX_ELEMENTS_PER_REQUEST} elementos por solicitud.`, 400);
  }
  const byGuid = new Map<string, TargetElement>();
  for (const raw of b.elements as unknown[]) {
    const el = (raw ?? {}) as Record<string, unknown>;
    const ifcGuid = String(el.ifcGuid ?? "");
    if (!isIfcGuid(ifcGuid)) throw new ServiceError(`"${ifcGuid.slice(0, 40)}" no es un IFCGUID válido.`, 400);
    const modelId = typeof el.modelId === "string" && el.modelId ? el.modelId.slice(0, 120) : "desconocido";
    byGuid.set(ifcGuid, { ifcGuid, modelId });
  }

  if (!Array.isArray(b.changes) || b.changes.length === 0) throw new ServiceError("No hay cambios para guardar.", 400);
  const catalog = await store.listDefinitions(projectId);
  const definitions = new Map(catalog.map((d) => [d.id, d]));
  const changes: ValueChange[] = [];
  const seen = new Set<string>();
  for (const raw of b.changes as unknown[]) {
    const c = (raw ?? {}) as { attributeId?: unknown; value?: unknown };
    const def = definitions.get(String(c.attributeId));
    if (!def) throw new ServiceError("Uno de los atributos ya no existe en el catálogo; recarga el panel.", 400);
    if (!def.active) {
      throw new ServiceError(`El atributo "${def.title}" está inactivo y no admite valores nuevos.`, 400, "inactive");
    }
    if (seen.has(def.id)) throw new ServiceError(`"${def.title}" aparece dos veces en los cambios.`, 400);
    seen.add(def.id);
    if (c.value === null) {
      changes.push({ attributeId: def.id, value: null });
      continue;
    }
    const check = validateValue(def.dataType, c.value);
    if (!check.ok) throw new ServiceError(`"${def.title}": ${check.error}.`, 400);
    changes.push({ attributeId: def.id, value: check.value });
  }

  const editable = await editableAttributeIds(
    caller,
    changes.map((c) => definitions.get(c.attributeId)!)
  );
  const notAllowed = changes.filter((c) => !editable.has(c.attributeId)).map((c) => `"${definitions.get(c.attributeId)!.title}"`);
  if (notAllowed.length) {
    throw new ServiceError(
      `No puedes asignar ${notAllowed.join(", ")}: solo sus responsables o un administrador del proyecto. No se guardó nada.`,
      403,
      "not-responsable"
    );
  }

  await store.saveValues(projectId, [...byGuid.values()], changes, caller.name);
  return { elements: byGuid.size, attributes: changes.length };
}

// ---------------------------------------------------------------- saved groupings

function readGroupingFields(value: unknown): SavedGroupingField[] {
  if (!Array.isArray(value) || value.length === 0) throw new ServiceError("Elige al menos una propiedad para agrupar.", 400);
  if (value.length > MAX_GROUPING_FIELDS) {
    throw new ServiceError(`Se puede agrupar por hasta ${MAX_GROUPING_FIELDS} propiedades.`, 400);
  }
  return value.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (typeof f.key !== "string" || !f.key.trim() || f.key.length > 300) {
      throw new ServiceError("Una de las propiedades de la agrupación no es válida.", 400);
    }
    const label = typeof f.label === "string" && f.label.trim() ? f.label.trim().slice(0, 200) : f.key.slice(0, 200);
    const group = typeof f.group === "string" ? f.group.trim().slice(0, 200) : "";
    return { key: f.key, label, group };
  });
}

function readModelNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50 || value.some((v) => typeof v !== "string" || v.length > 300)) {
    throw new ServiceError("La lista de modelos no es válida.", 400);
  }
  return [...new Set(value as string[])];
}

/** The project's saved groupings; each says whether this user can delete it. */
export async function listSavedGroupings(store: PropertiesStore, caller: Caller, projectId: string): Promise<SavedGrouping[]> {
  return (await store.listGroupings(projectId)).map((g) => ({
    ...g,
    canDelete: caller.isAdmin || (!!g.createdById && g.createdById === caller.id),
  }));
}

/** Any member of the project can save a grouping; names are unique in the project. */
export async function createSavedGrouping(
  store: PropertiesStore,
  caller: Caller,
  projectId: string,
  body: unknown
): Promise<SavedGrouping> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = cleanText(b.name, "el nombre de la configuración", MAX_GROUPING_NAME_LENGTH);
  const fields = readGroupingFields(b.fields);
  const modelNames = readModelNames(b.modelNames);
  const existing = await store.listGroupings(projectId);
  if (existing.length >= MAX_SAVED_GROUPINGS) {
    throw new ServiceError(`El proyecto ya tiene ${MAX_SAVED_GROUPINGS} configuraciones guardadas: elimina alguna antes de guardar otra.`, 409);
  }
  const clash = existing.find((g) => g.name.localeCompare(name, "es", { sensitivity: "base" }) === 0);
  const duplicate = () =>
    new ServiceError(`Ya existe una configuración llamada "${clash?.name ?? name}". Usa otro nombre.`, 409, "duplicate-name");
  if (clash) throw duplicate();
  const saved = await store.insertGrouping(projectId, { name, fields, modelNames }, caller.name, caller.id);
  if (saved === "duplicate-name") throw duplicate();
  return { ...saved, canDelete: true };
}

/** Only the one who saved it, or a project administrator, deletes a grouping. */
export async function deleteSavedGrouping(store: PropertiesStore, caller: Caller, projectId: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new ServiceError("El identificador de la configuración no es válido.", 400);
  const grouping = (await store.listGroupings(projectId)).find((g) => g.id === id);
  if (!grouping) throw new ServiceError("La configuración no existe en este proyecto.", 404);
  if (!caller.isAdmin && grouping.createdById !== caller.id) {
    throw new ServiceError("Solo quien guardó esta configuración o un administrador del proyecto puede eliminarla.", 403, "not-owner");
  }
  await store.deleteGrouping(projectId, id);
}
