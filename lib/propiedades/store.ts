import { randomUUID } from "node:crypto";
import type {
  AttributeDefinition,
  AttributeValue,
  DataType,
  DefinitionInput,
  Responsable,
  SavedGroupingInput,
  StoredValue,
  TargetElement,
  ValueChange,
} from "./types";

/**
 * Persistence of the "Propiedades" data service: the attribute catalog and the
 * values assigned per IFCGUID. Two implementations with the same rules:
 *  - Supabase (Postgres, through its REST API with the server-only service
 *    key), using the tables, view and function in supabase/propiedades.sql;
 *  - in memory, for `next dev` without a database and for tests.
 */
export interface PropertiesStore {
  listDefinitions(projectId: string): Promise<AttributeDefinition[]>;
  getDefinition(projectId: string, id: string): Promise<AttributeDefinition | null>;
  insertDefinition(projectId: string, input: DefinitionInput, user: string): Promise<AttributeDefinition>;
  updateDefinition(
    projectId: string,
    id: string,
    patch: Partial<DefinitionInput> & { active?: boolean },
    user: string
  ): Promise<AttributeDefinition | null>;
  /** "has-values" when values reference it: it can only be deactivated. */
  deleteDefinition(projectId: string, id: string): Promise<"deleted" | "has-values" | "not-found">;
  getValues(projectId: string, guids: string[]): Promise<StoredValue[]>;
  /** Applies every change to every element, all or nothing. */
  saveValues(projectId: string, elements: TargetElement[], changes: ValueChange[], user: string): Promise<void>;
  listGroupings(projectId: string): Promise<StoredGrouping[]>;
  /** "duplicate-name" when another one of the project already has that name. */
  insertGrouping(projectId: string, input: SavedGroupingInput, user: string, userId: string): Promise<StoredGrouping | "duplicate-name">;
  deleteGrouping(projectId: string, id: string): Promise<boolean>;
}

/** A saved grouping as stored (who may delete it is decided by the service). */
export interface StoredGrouping extends SavedGroupingInput {
  id: string;
  createdBy: string | null;
  createdById: string | null;
  createdAt: string;
}

export class StoreError extends Error {
  constructor(
    message: string,
    public status = 503
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- Supabase

const REQUEST_TIMEOUT_MS = 15_000;
const GUIDS_PER_QUERY = 150;

interface DefinitionRow {
  id: string;
  project_id: string;
  title: string;
  data_type: DataType;
  group_name: string;
  sort_order: number;
  active: boolean;
  value_count?: number | string;
  /** Missing until supabase/propiedades.sql is run again after the upgrade. */
  responsables?: Responsable[] | null;
  updated_at: string;
  updated_by: string | null;
}

interface ValueRow {
  ifc_guid: string;
  model_id: string;
  attribute_id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  updated_at: string;
  updated_by: string | null;
}

function toDefinition(row: DefinitionRow): AttributeDefinition {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    dataType: row.data_type,
    group: row.group_name,
    sortOrder: row.sort_order,
    active: row.active,
    valueCount: Number(row.value_count ?? 0),
    responsables: Array.isArray(row.responsables) ? row.responsables : [],
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

interface GroupingRow {
  id: string;
  name: string;
  config: { fields?: SavedGroupingInput["fields"]; modelNames?: string[] } | null;
  created_by: string | null;
  created_by_id: string | null;
  created_at: string;
}

function toGrouping(row: GroupingRow): StoredGrouping {
  return {
    id: row.id,
    name: row.name,
    fields: Array.isArray(row.config?.fields) ? row.config!.fields! : [],
    modelNames: Array.isArray(row.config?.modelNames) ? row.config!.modelNames! : [],
    createdBy: row.created_by,
    createdById: row.created_by_id,
    createdAt: row.created_at,
  };
}

function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), "es", { sensitivity: "base" }) === 0;
}

function toValue(row: ValueRow): StoredValue {
  const value: AttributeValue =
    row.value_text ?? row.value_number ?? row.value_boolean ?? (row.value_date as string);
  return {
    ifcGuid: row.ifc_guid,
    modelId: row.model_id,
    attributeId: row.attribute_id,
    value,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const SETUP_HINT =
  "Falta crear las tablas de Propiedades en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/propiedades.sql del repositorio.";

const UPGRADE_HINT =
  "Falta actualizar las tablas de Propiedades: abre Supabase → SQL Editor y ejecuta de nuevo el archivo supabase/propiedades.sql del repositorio (es seguro repetirlo; no borra datos).";

function supabaseStore(): PropertiesStore | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;

  const rest = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and also go in Authorization; the newer
  // "sb_secret_…" keys are not JWTs and must only be sent as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${rest}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    let detail: { code?: string; message?: string } = {};
    try {
      detail = JSON.parse(body);
    } catch {
      // not JSON
    }
    if (/responsables/i.test(body) && /PGRST204|42703|column/i.test(body)) throw new StoreError(UPGRADE_HINT);
    if (/propiedades_agrupaciones/i.test(body)) throw new StoreError(UPGRADE_HINT);
    // Unique name per project (also checked before inserting).
    if (detail.code === "23505") throw new StoreError("duplicate-name", 409);
    if (/PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body)) {
      throw new StoreError(SETUP_HINT);
    }
    if (res.status === 401 || res.status === 403) {
      throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    // RESTRICT (23001) / foreign key (23503): the definition still has values.
    if (detail.code === "23001" || detail.code === "23503") throw new StoreError("has-values", 409);
    // Raised by propiedades_guardar_valores: inactive attribute, wrong project, bad value.
    if (detail.code && /^(P0001|P0002|22\w{3}|23514)$/.test(detail.code)) {
      throw new StoreError(detail.message ?? "Valor no válido.", 400);
    }
    throw new StoreError(`Supabase respondió ${res.status}${detail.message ? `: ${detail.message}` : ""}`);
  }

  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

  return {
    async listDefinitions(projectId) {
      const res = await call(
        `/propiedades_definiciones_uso?project_id=${eq(projectId)}&order=sort_order.asc,title.asc`
      );
      return ((await res.json()) as DefinitionRow[]).map(toDefinition);
    },

    async getDefinition(projectId, id) {
      const res = await call(`/propiedades_definiciones_uso?project_id=${eq(projectId)}&id=${eq(id)}`);
      const rows = (await res.json()) as DefinitionRow[];
      return rows.length ? toDefinition(rows[0]) : null;
    },

    async insertDefinition(projectId, input, user) {
      const res = await call("/propiedades_definiciones", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          project_id: projectId,
          title: input.title,
          data_type: input.dataType,
          group_name: input.group,
          sort_order: input.sortOrder,
          // Only sent when set, so the catalog keeps working before the upgrade.
          ...(input.responsables?.length ? { responsables: input.responsables } : {}),
          created_by: user,
          updated_by: user,
        }),
      });
      const [row] = (await res.json()) as DefinitionRow[];
      return toDefinition({ ...row, value_count: 0 });
    },

    async updateDefinition(projectId, id, patch, user) {
      const body: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: user };
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.dataType !== undefined) body.data_type = patch.dataType;
      if (patch.group !== undefined) body.group_name = patch.group;
      if (patch.sortOrder !== undefined) body.sort_order = patch.sortOrder;
      if (patch.active !== undefined) body.active = patch.active;
      if (patch.responsables !== undefined) body.responsables = patch.responsables;
      const res = await call(`/propiedades_definiciones?project_id=${eq(projectId)}&id=${eq(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      await res.text();
      return this.getDefinition(projectId, id);
    },

    async deleteDefinition(projectId, id) {
      try {
        const res = await call(`/propiedades_definiciones?project_id=${eq(projectId)}&id=${eq(id)}`, {
          method: "DELETE",
          headers: { Prefer: "return=representation" },
        });
        const rows = (await res.json()) as unknown[];
        return rows.length ? "deleted" : "not-found";
      } catch (err) {
        if (err instanceof StoreError && err.message === "has-values") return "has-values";
        throw err;
      }
    },

    async getValues(projectId, guids) {
      const out: StoredValue[] = [];
      for (let i = 0; i < guids.length; i += GUIDS_PER_QUERY) {
        // GUIDs only use [0-9A-Za-z_$]; quoting keeps PostgREST from reading anything as syntax.
        const list = guids.slice(i, i + GUIDS_PER_QUERY).map((g) => `"${g}"`).join(",");
        const res = await call(
          `/propiedades_valores?project_id=${eq(projectId)}&ifc_guid=in.(${encodeURIComponent(list)})` +
            "&select=ifc_guid,model_id,attribute_id,value_text,value_number,value_boolean,value_date,updated_at,updated_by"
        );
        out.push(...((await res.json()) as ValueRow[]).map(toValue));
      }
      return out;
    },

    async saveValues(projectId, elements, changes, user) {
      const res = await call("/rpc/propiedades_guardar_valores", {
        method: "POST",
        body: JSON.stringify({ p_project_id: projectId, p_items: elements, p_changes: changes, p_user: user }),
      });
      await res.text();
    },

    async listGroupings(projectId) {
      const res = await call(
        `/propiedades_agrupaciones?project_id=${eq(projectId)}&select=id,name,config,created_by,created_by_id,created_at&order=name.asc`
      );
      return ((await res.json()) as GroupingRow[]).map(toGrouping);
    },

    async insertGrouping(projectId, input, user, userId) {
      try {
        const res = await call("/propiedades_agrupaciones", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            project_id: projectId,
            name: input.name,
            config: { fields: input.fields, modelNames: input.modelNames },
            created_by: user,
            created_by_id: userId,
          }),
        });
        const [row] = (await res.json()) as GroupingRow[];
        return toGrouping(row);
      } catch (err) {
        if (err instanceof StoreError && err.message === "duplicate-name") return "duplicate-name";
        throw err;
      }
    },

    async deleteGrouping(projectId, id) {
      const res = await call(`/propiedades_agrupaciones?project_id=${eq(projectId)}&id=${eq(id)}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return ((await res.json()) as unknown[]).length > 0;
    },
  };
}

// ---------------------------------------------------------------- memory

/** Same rules as the SQL schema, kept in memory (development and tests). */
export function memoryStore(): PropertiesStore {
  const definitions = new Map<string, AttributeDefinition>();
  const values = new Map<string, StoredValue & { projectId: string }>(); // key: project|guid|attribute
  const groupings = new Map<string, StoredGrouping & { projectId: string }>();

  const valueKey = (projectId: string, guid: string, attributeId: string) => `${projectId}|${guid}|${attributeId}`;
  const countFor = (id: string) => [...values.values()].filter((v) => v.attributeId === id).length;
  const withCount = (d: AttributeDefinition) => ({ ...d, valueCount: countFor(d.id) });

  return {
    async listDefinitions(projectId) {
      return [...definitions.values()]
        .filter((d) => d.projectId === projectId)
        .map(withCount)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    },
    async getDefinition(projectId, id) {
      const d = definitions.get(id);
      return d && d.projectId === projectId ? withCount(d) : null;
    },
    async insertDefinition(projectId, input, user) {
      const now = new Date().toISOString();
      const def: AttributeDefinition = {
        id: randomUUID(),
        projectId,
        ...input,
        responsables: input.responsables ?? [],
        active: true,
        valueCount: 0,
        updatedAt: now,
        updatedBy: user,
      };
      definitions.set(def.id, def);
      return def;
    },
    async updateDefinition(projectId, id, patch, user) {
      const d = definitions.get(id);
      if (!d || d.projectId !== projectId) return null;
      const next = { ...d, ...patch, updatedAt: new Date().toISOString(), updatedBy: user };
      definitions.set(id, next);
      return withCount(next);
    },
    async deleteDefinition(projectId, id) {
      const d = definitions.get(id);
      if (!d || d.projectId !== projectId) return "not-found";
      if (countFor(id) > 0) return "has-values";
      definitions.delete(id);
      return "deleted";
    },
    async getValues(projectId, guids) {
      const wanted = new Set(guids);
      return [...values.values()]
        .filter((v) => v.projectId === projectId && wanted.has(v.ifcGuid))
        .map(({ projectId: _p, ...v }) => v);
    },
    async saveValues(projectId, elements, changes, user) {
      // Validate everything first so a bad change leaves nothing half-written.
      for (const change of changes) {
        const d = definitions.get(change.attributeId);
        if (!d || d.projectId !== projectId) throw new StoreError(`El atributo ${change.attributeId} no existe en este proyecto`, 400);
        if (!d.active) throw new StoreError(`El atributo "${d.title}" está inactivo y no admite valores nuevos`, 400);
      }
      const now = new Date().toISOString();
      for (const change of changes) {
        for (const el of elements) {
          const key = valueKey(projectId, el.ifcGuid, change.attributeId);
          if (change.value === null) values.delete(key);
          else
            values.set(key, {
              projectId,
              ifcGuid: el.ifcGuid,
              modelId: el.modelId,
              attributeId: change.attributeId,
              value: change.value,
              updatedAt: now,
              updatedBy: user,
            });
        }
      }
    },
    async listGroupings(projectId) {
      return [...groupings.values()]
        .filter((g) => g.projectId === projectId)
        .map(({ projectId: _p, ...g }) => g)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    },
    async insertGrouping(projectId, input, user, userId) {
      if ([...groupings.values()].some((g) => g.projectId === projectId && sameName(g.name, input.name))) return "duplicate-name";
      const grouping: StoredGrouping = {
        id: randomUUID(),
        ...input,
        createdBy: user,
        createdById: userId,
        createdAt: new Date().toISOString(),
      };
      groupings.set(grouping.id, { ...grouping, projectId });
      return grouping;
    },
    async deleteGrouping(projectId, id) {
      const g = groupings.get(id);
      if (!g || g.projectId !== projectId) return false;
      groupings.delete(id);
      return true;
    },
  };
}

// ---------------------------------------------------------------- selection

let selected: PropertiesStore | null | undefined;
let devStore: PropertiesStore | undefined;

export function propertiesStore(): PropertiesStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError(
      "La base de datos de Propiedades no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/propiedades.sql y vuelve a desplegar."
    );
  }
  return (devStore ??= memoryStore());
}
