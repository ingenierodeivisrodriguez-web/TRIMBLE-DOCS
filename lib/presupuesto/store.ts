import type { Responsable } from "../propiedades/types";
import { StoreError } from "../propiedades/store";
import type {
  ElementoVinculado,
  Insumo,
  InsumoData,
  Medicion,
  OmniclassEntry,
  PartidaCatalogo,
  PartidaData,
  ResumenItem,
} from "./types";

/**
 * Persistence of "Presupuesto". Two implementations with the same rules:
 * Supabase (tables and functions of supabase/presupuesto.sql, through its REST
 * API with the server-only key) and memory (for `next dev` without a database
 * and for tests).
 */
export interface StoredConfig {
  baseProjectId: string;
  baseProjectName: string;
  editores: Responsable[];
}

export interface StoredDocumento {
  data: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PresupuestoStore {
  getConfig(projectId: string): Promise<StoredConfig | null>;
  saveConfig(projectId: string, config: StoredConfig, user: string): Promise<void>;

  listInsumos(baseId: string): Promise<Insumo[]>;
  /** Inserts or updates by id; rows whose id belongs to another catalog are skipped. Returns how many were saved. */
  saveInsumos(baseId: string, rows: (InsumoData & { id: string })[], user: string): Promise<number>;
  deleteInsumo(baseId: string, id: string): Promise<boolean>;
  listPartidas(baseId: string): Promise<PartidaCatalogo[]>;
  savePartidas(baseId: string, rows: (PartidaData & { id: string })[], user: string): Promise<number>;
  deletePartida(baseId: string, id: string): Promise<boolean>;
  /** Catalog partidas whose APU uses this resource or subpartida (to refuse deleting it). */
  partidasQueUsan(baseId: string, componentId: string): Promise<PartidaCatalogo[]>;
  listOmniclass(baseId: string): Promise<OmniclassEntry[]>;
  saveOmniclass(baseId: string, rows: OmniclassEntry[]): Promise<number>;

  getDocumento(projectId: string): Promise<StoredDocumento | null>;
  /** Saves if the stored version is still `version` (0: none yet); returns the new version. */
  saveDocumento(projectId: string, data: unknown, version: number, user: string): Promise<number | "conflict">;

  listMediciones(projectId: string): Promise<Medicion[]>;
  saveMedicion(projectId: string, medicion: Medicion, user: string): Promise<void>;
  resumenElementos(projectId: string): Promise<ResumenItem[]>;
  getElementos(projectId: string, filter: { itemIds?: string[]; ifcGuids?: string[] }): Promise<ElementoVinculado[]>;
  /** Adds or updates elements of a partida and removes others (by IFCGUID). */
  saveElementos(
    projectId: string,
    itemId: string,
    upsert: { ifcGuid: string; modelId: string; cantidad: number | null }[],
    remove: string[],
    user: string
  ): Promise<void>;
}

// ---------------------------------------------------------------- Supabase

const REQUEST_TIMEOUT_MS = 20_000;
const PAGE = 1000;
const IN_CHUNK = 150;

const SETUP_HINT =
  "Faltan las tablas de Presupuesto en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/presupuesto.sql del repositorio.";

interface InsumoRow {
  id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  precio: number | string;
  tipo: Insumo["tipo"];
  iu: string;
  omniclass: string;
  updated_at: string;
  updated_by: string | null;
}

interface PartidaRow {
  id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  rendimiento: number | string;
  jornada: number | string;
  omniclass: string;
  componentes: PartidaCatalogo["componentes"] | null;
  updated_at: string;
  updated_by: string | null;
}

function toInsumo(r: InsumoRow): Insumo {
  return {
    id: r.id,
    codigo: r.codigo,
    descripcion: r.descripcion,
    unidad: r.unidad,
    precio: Number(r.precio),
    tipo: r.tipo,
    iu: r.iu,
    omniclass: r.omniclass,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toPartida(r: PartidaRow): PartidaCatalogo {
  return {
    id: r.id,
    codigo: r.codigo,
    descripcion: r.descripcion,
    unidad: r.unidad,
    rendimiento: Number(r.rendimiento),
    jornada: Number(r.jornada),
    omniclass: r.omniclass,
    componentes: Array.isArray(r.componentes) ? r.componentes : [],
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function supabaseStore(): PresupuestoStore | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;

  const rest = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs; the newer "sb_secret_…" keys only go as `apikey`.
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
    if (/version-conflict/.test(body)) throw new StoreError("version-conflict", 409);
    if (detail.code === "23505") throw new StoreError("duplicate-code", 409);
    if (/PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body)) throw new StoreError(SETUP_HINT);
    if (res.status === 401 || res.status === 403) {
      throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    if (detail.code && /^(22\w{3}|23514)$/.test(detail.code)) throw new StoreError(detail.message ?? "Valor no válido.", 400);
    throw new StoreError(`Supabase respondió ${res.status}${detail.message ? `: ${detail.message}` : ""}`);
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await call(path, init)).json()) as T;
  }

  /** Every row of a query, a page at a time (Supabase caps each answer). */
  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await json<T[]>(`${path}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
  const inList = (values: string[]) => `in.(${encodeURIComponent(values.map((v) => `"${v}"`).join(","))})`;
  const rpc = (fn: string, body: unknown) => json<number>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

  return {
    async getConfig(projectId) {
      const rows = await json<{ base_project_id: string; base_project_name: string; editores: Responsable[] | null }[]>(
        `/presupuesto_config?project_id=${eq(projectId)}&select=base_project_id,base_project_name,editores`
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { baseProjectId: r.base_project_id, baseProjectName: r.base_project_name, editores: Array.isArray(r.editores) ? r.editores : [] };
    },

    async saveConfig(projectId, config, user) {
      await call("/presupuesto_config?on_conflict=project_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          project_id: projectId,
          base_project_id: config.baseProjectId,
          base_project_name: config.baseProjectName,
          editores: config.editores,
          updated_at: new Date().toISOString(),
          updated_by: user,
        }),
      });
    },

    async listInsumos(baseId) {
      const rows = await all<InsumoRow>(
        `/presupuesto_insumos?base_id=${eq(baseId)}&select=id,codigo,descripcion,unidad,precio,tipo,iu,omniclass,updated_at,updated_by&order=descripcion.asc,id.asc`
      );
      return rows.map(toInsumo);
    },

    async saveInsumos(baseId, rows, user) {
      let saved = 0;
      for (const batch of chunks(rows, 500)) saved += await rpc("presupuesto_guardar_insumos", { p_base_id: baseId, p_rows: batch, p_user: user });
      return saved;
    },

    async deleteInsumo(baseId, id) {
      const rows = await json<unknown[]>(`/presupuesto_insumos?base_id=${eq(baseId)}&id=${eq(id)}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length > 0;
    },

    async listPartidas(baseId) {
      const rows = await all<PartidaRow>(
        `/presupuesto_partidas?base_id=${eq(baseId)}&select=id,codigo,descripcion,unidad,rendimiento,jornada,omniclass,componentes,updated_at,updated_by&order=descripcion.asc,id.asc`
      );
      return rows.map(toPartida);
    },

    async savePartidas(baseId, rows, user) {
      let saved = 0;
      for (const batch of chunks(rows, 200)) saved += await rpc("presupuesto_guardar_partidas", { p_base_id: baseId, p_rows: batch, p_user: user });
      return saved;
    },

    async deletePartida(baseId, id) {
      const rows = await json<unknown[]>(`/presupuesto_partidas?base_id=${eq(baseId)}&id=${eq(id)}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return rows.length > 0;
    },

    async partidasQueUsan(baseId, componentId) {
      const filter = encodeURIComponent(JSON.stringify([{ id: componentId }]));
      const rows = await json<PartidaRow[]>(
        `/presupuesto_partidas?base_id=${eq(baseId)}&componentes=cs.${filter}&select=id,codigo,descripcion,unidad,rendimiento,jornada,omniclass,componentes,updated_at,updated_by&limit=20`
      );
      return rows.map(toPartida);
    },

    async listOmniclass(baseId) {
      return all<OmniclassEntry>(`/presupuesto_omniclass?base_id=${eq(baseId)}&select=codigo,titulo&order=codigo.asc`);
    },

    async saveOmniclass(baseId, rows) {
      for (const batch of chunks(rows, 1000)) {
        await call("/presupuesto_omniclass?on_conflict=base_id,codigo", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(batch.map((r) => ({ base_id: baseId, codigo: r.codigo, titulo: r.titulo }))),
        });
      }
      return rows.length;
    },

    async getDocumento(projectId) {
      const rows = await json<{ data: unknown; version: number; updated_at: string; updated_by: string | null }[]>(
        `/presupuesto_documentos?project_id=${eq(projectId)}&select=data,version,updated_at,updated_by`
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { data: r.data, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by };
    },

    async saveDocumento(projectId, data, version, user) {
      try {
        return await rpc("presupuesto_guardar", { p_project_id: projectId, p_data: data, p_version: version, p_user: user });
      } catch (err) {
        if (err instanceof StoreError && err.message === "version-conflict") return "conflict";
        throw err;
      }
    },

    async listMediciones(projectId) {
      const rows = await json<{ item_id: string; campo: string | null; campo_label: string; unidad: string }[]>(
        `/presupuesto_mediciones?project_id=${eq(projectId)}&select=item_id,campo,campo_label,unidad`
      );
      return rows.map((r) => ({ itemId: r.item_id, campo: r.campo, campoLabel: r.campo_label, unidad: r.unidad }));
    },

    async saveMedicion(projectId, m, user) {
      await call("/presupuesto_mediciones?on_conflict=project_id,item_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          project_id: projectId,
          item_id: m.itemId,
          campo: m.campo,
          campo_label: m.campoLabel,
          unidad: m.unidad,
          updated_at: new Date().toISOString(),
          updated_by: user,
        }),
      });
    },

    async resumenElementos(projectId) {
      const rows = await all<{ item_id: string; elementos: number | string; suma: number | string }>(
        `/presupuesto_resumen_elementos?project_id=${eq(projectId)}&select=item_id,elementos,suma&order=item_id.asc`
      );
      return rows.map((r) => ({ itemId: r.item_id, elementos: Number(r.elementos), suma: Number(r.suma) }));
    },

    async getElementos(projectId, filter) {
      type Row = { item_id: string; ifc_guid: string; model_id: string; cantidad: number | null };
      const select = "&select=item_id,ifc_guid,model_id,cantidad&order=id.asc";
      const toEl = (r: Row): ElementoVinculado => ({ itemId: r.item_id, ifcGuid: r.ifc_guid, modelId: r.model_id, cantidad: r.cantidad });
      const out: ElementoVinculado[] = [];
      for (const ids of chunks(filter.itemIds ?? [], IN_CHUNK)) {
        out.push(...(await all<Row>(`/presupuesto_elementos?project_id=${eq(projectId)}&item_id=${inList(ids)}${select}`)).map(toEl));
      }
      for (const guids of chunks(filter.ifcGuids ?? [], IN_CHUNK)) {
        out.push(...(await all<Row>(`/presupuesto_elementos?project_id=${eq(projectId)}&ifc_guid=${inList(guids)}${select}`)).map(toEl));
      }
      return out;
    },

    async saveElementos(projectId, itemId, upsert, remove, user) {
      for (const batch of chunks(upsert, 500)) {
        await call("/presupuesto_elementos?on_conflict=project_id,item_id,ifc_guid", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(
            batch.map((e) => ({
              project_id: projectId,
              item_id: itemId,
              ifc_guid: e.ifcGuid,
              model_id: e.modelId,
              cantidad: e.cantidad,
              updated_at: new Date().toISOString(),
              updated_by: user,
            }))
          ),
        });
      }
      for (const guids of chunks(remove, IN_CHUNK)) {
        await call(`/presupuesto_elementos?project_id=${eq(projectId)}&item_id=${eq(itemId)}&ifc_guid=${inList(guids)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });
      }
    },
  };
}

// ---------------------------------------------------------------- memory

export function memoryStore(): PresupuestoStore {
  const configs = new Map<string, StoredConfig>();
  const insumos = new Map<string, Insumo & { baseId: string }>();
  const partidas = new Map<string, PartidaCatalogo & { baseId: string }>();
  const omniclass = new Map<string, OmniclassEntry & { baseId: string }>();
  const documentos = new Map<string, StoredDocumento>();
  const mediciones = new Map<string, Medicion & { projectId: string }>();
  const elementos = new Map<string, ElementoVinculado & { projectId: string }>();

  const strip = <T extends { baseId: string }>({ baseId: _b, ...rest }: T) => rest;
  const byDescripcion = (a: { descripcion: string }, b: { descripcion: string }) => a.descripcion.localeCompare(b.descripcion);
  const codeKey = (code: string) => code.trim().toLowerCase();

  function checkUniqueCodes<T extends { id: string; codigo: string; baseId: string }>(map: Map<string, T>, baseId: string) {
    const seen = new Set<string>();
    for (const row of map.values()) {
      if (row.baseId !== baseId || !row.codigo.trim()) continue;
      if (seen.has(codeKey(row.codigo))) throw new StoreError("duplicate-code", 409);
      seen.add(codeKey(row.codigo));
    }
  }

  function saveRows<T extends { id: string; codigo: string; baseId: string }>(map: Map<string, T>, baseId: string, rows: T[]): number {
    const before = new Map(map);
    let saved = 0;
    for (const row of rows) {
      const existing = map.get(row.id);
      if (existing && existing.baseId !== baseId) continue;
      map.set(row.id, row);
      saved++;
    }
    try {
      checkUniqueCodes(map, baseId);
    } catch (err) {
      map.clear();
      for (const [k, v] of before) map.set(k, v);
      throw err;
    }
    return saved;
  }

  return {
    async getConfig(projectId) {
      return configs.get(projectId) ?? null;
    },
    async saveConfig(projectId, config) {
      configs.set(projectId, { ...config });
    },
    async listInsumos(baseId) {
      return [...insumos.values()].filter((i) => i.baseId === baseId).map(strip).sort(byDescripcion);
    },
    async saveInsumos(baseId, rows, user) {
      const now = new Date().toISOString();
      return saveRows(insumos, baseId, rows.map((r) => ({ ...r, baseId, updatedAt: now, updatedBy: user })));
    },
    async deleteInsumo(baseId, id) {
      const row = insumos.get(id);
      if (!row || row.baseId !== baseId) return false;
      insumos.delete(id);
      return true;
    },
    async listPartidas(baseId) {
      return [...partidas.values()].filter((p) => p.baseId === baseId).map(strip).sort(byDescripcion);
    },
    async savePartidas(baseId, rows, user) {
      const now = new Date().toISOString();
      return saveRows(partidas, baseId, rows.map((r) => ({ ...r, baseId, updatedAt: now, updatedBy: user })));
    },
    async deletePartida(baseId, id) {
      const row = partidas.get(id);
      if (!row || row.baseId !== baseId) return false;
      partidas.delete(id);
      return true;
    },
    async partidasQueUsan(baseId, componentId) {
      return [...partidas.values()]
        .filter((p) => p.baseId === baseId && p.componentes.some((c) => c.id === componentId))
        .map(strip);
    },
    async listOmniclass(baseId) {
      return [...omniclass.values()]
        .filter((o) => o.baseId === baseId)
        .map(({ codigo, titulo }) => ({ codigo, titulo }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },
    async saveOmniclass(baseId, rows) {
      for (const r of rows) omniclass.set(`${baseId}|${r.codigo}`, { ...r, baseId });
      return rows.length;
    },
    async getDocumento(projectId) {
      const d = documentos.get(projectId);
      return d ? { ...d, data: structuredClone(d.data) } : null;
    },
    async saveDocumento(projectId, data, version, user) {
      const current = documentos.get(projectId);
      if ((current?.version ?? 0) !== version) return "conflict";
      const next = version + 1;
      documentos.set(projectId, { data: structuredClone(data), version: next, updatedAt: new Date().toISOString(), updatedBy: user });
      const partidaIds = new Set(
        ((data as { subpresupuestos?: { items?: { id: string; tipo: string }[] }[] }).subpresupuestos ?? []).flatMap((sp) =>
          (sp.items ?? []).filter((i) => i.tipo === "partida").map((i) => i.id)
        )
      );
      for (const [k, e] of elementos) if (e.projectId === projectId && !partidaIds.has(e.itemId)) elementos.delete(k);
      for (const [k, m] of mediciones) if (m.projectId === projectId && !partidaIds.has(m.itemId)) mediciones.delete(k);
      return next;
    },
    async listMediciones(projectId) {
      return [...mediciones.values()].filter((m) => m.projectId === projectId).map(({ projectId: _p, ...m }) => m);
    },
    async saveMedicion(projectId, m) {
      mediciones.set(`${projectId}|${m.itemId}`, { ...m, projectId });
    },
    async resumenElementos(projectId) {
      const out = new Map<string, ResumenItem>();
      for (const e of elementos.values()) {
        if (e.projectId !== projectId) continue;
        const r = out.get(e.itemId) ?? { itemId: e.itemId, elementos: 0, suma: 0 };
        r.elementos++;
        r.suma += e.cantidad ?? 0;
        out.set(e.itemId, r);
      }
      return [...out.values()];
    },
    async getElementos(projectId, filter) {
      const items = new Set(filter.itemIds ?? []);
      const guids = new Set(filter.ifcGuids ?? []);
      return [...elementos.values()]
        .filter((e) => e.projectId === projectId && (items.has(e.itemId) || guids.has(e.ifcGuid)))
        .map(({ projectId: _p, ...e }) => e);
    },
    async saveElementos(projectId, itemId, upsert, remove) {
      for (const e of upsert) elementos.set(`${projectId}|${itemId}|${e.ifcGuid}`, { projectId, itemId, ...e });
      for (const g of remove) elementos.delete(`${projectId}|${itemId}|${g}`);
    },
  };
}

// ---------------------------------------------------------------- selection

let selected: PresupuestoStore | null | undefined;
let devStore: PresupuestoStore | undefined;

export function presupuestoStore(): PresupuestoStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError(
      "La base de datos de Presupuesto no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/presupuesto.sql y vuelve a desplegar."
    );
  }
  return (devStore ??= memoryStore());
}
