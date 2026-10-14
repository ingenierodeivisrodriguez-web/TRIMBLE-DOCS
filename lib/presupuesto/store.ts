import type { Responsable } from "../propiedades/types";
import type { BorradorGenerico, CupoGuardado, EstadoBorrador, RegistroUsoIA, ResumenesIA, TareaIA } from "./ia/tipos";
import { StoreError } from "../propiedades/store";
import type {
  CamposModelo,
  ModeloUsado,
  VistaPendiente,
  ColumnaMemoria,
  ElementoVinculado,
  Insumo,
  InsumoData,
  Medicion,
  Memoria,
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
  /** Not set: the default columns. */
  memoriaColumnas?: ColumnaMemoria[];
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

  /** The models the linked elements belong to, with how many elements each has. */
  modelosUsados(projectId: string): Promise<ModeloUsado[]>;
  /** Remembers what this user asked to see in 3D (replacing the previous request). */
  saveVista(projectId: string, userId: string, vista: VistaPendiente): Promise<void>;
  /** The pending request of this user, removed when read; null when none (or older than `maxMinutos`). */
  takeVista(projectId: string, userId: string, maxMinutos: number): Promise<VistaPendiente | null>;

  getCamposModelo(projectId: string): Promise<CamposModelo | null>;
  saveCamposModelo(projectId: string, data: Pick<CamposModelo, "modelos" | "campos">, user: string): Promise<void>;

  getDocumento(projectId: string): Promise<StoredDocumento | null>;
  // ---- the AI assistant ("_global" holds the defaults)
  getCupoIA(projectId: string): Promise<CupoGuardado | null>;
  /** Every project with its own quota (not "_global"). */
  listarCuposIA(): Promise<(CupoGuardado & { projectId: string })[]>;
  /** Pesos spent since `desde`, by project. */
  gastoProyectosIA(desde: string): Promise<Map<string, number>>;
  saveCupoIA(projectId: string, cupo: CupoGuardado, user: string): Promise<void>;
  /** Logs a call to the model; returns its id. */
  registrarUsoIA(uso: Omit<RegistroUsoIA, "id" | "creado">): Promise<number>;
  /** Pesos spent since `desde` by the project and by one person. */
  gastoIA(projectId: string, desde: string, userId: string): Promise<{ proyecto: number; usuario: number }>;
  usosIA(projectId: string, limite: number): Promise<RegistroUsoIA[]>;
  /** Saves new drafts; the pending ones of the same partidas and task are marked "reemplazado". */
  guardarBorradoresIA(projectId: string, borradores: BorradorGenerico[]): Promise<void>;
  borradoresIA(projectId: string, filtro: { estado?: EstadoBorrador; tarea?: TareaIA; ids?: string[] }): Promise<BorradorGenerico[]>;
  /** Records the decisions on pending drafts; returns how many changed. */
  decidirBorradoresIA(
    projectId: string,
    decisiones: { id: string; estado: "aceptado" | "rechazado"; editado: boolean; final: BorradorGenerico["final"] }[],
    user: string
  ): Promise<number>;
  /** The evaluation of each task. */
  resumenBorradoresIA(projectId: string): Promise<ResumenesIA>;
  /** The schedule (Gantt), versioned like the budget. */
  getProgramacion(projectId: string): Promise<StoredDocumento | null>;
  saveProgramacion(projectId: string, data: unknown, version: number, user: string): Promise<number | "conflict">;
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
    upsert: { ifcGuid: string; modelId: string; cantidad: number | null; memoria: Memoria | null }[],
    remove: string[],
    user: string
  ): Promise<void>;
}

// ---------------------------------------------------------------- Supabase

const REQUEST_TIMEOUT_MS = 20_000;
const LENTA = "La base de datos (Supabase) tardó demasiado en responder. Intenta de nuevo en un momento.";
/** The request ran out of time (the fetch or reading its answer). */
const esTiempo = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
const PAGE = 1000;
const IN_CHUNK = 150;

const SETUP_HINT =
  "Faltan las tablas de Presupuesto en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/presupuesto.sql del repositorio.";

const UPGRADE_HINT =
  "Falta actualizar las tablas de Presupuesto: abre Supabase → SQL Editor y ejecuta de nuevo el archivo supabase/presupuesto.sql del repositorio (es seguro repetirlo; no borra datos).";

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
  edt?: PartidaCatalogo["edt"] | null;
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
    ...(r.edt ? { edt: r.edt } : {}),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

interface CupoRow {
  project_id: string;
  habilitada: boolean;
  cupo_proyecto_cop: number | string;
  cupo_usuario_cop: number | string;
  trm: number | string | null;
  project_name?: string | null;
  updated_at: string;
  updated_by: string | null;
}

function cupoDeFila(r: CupoRow): CupoGuardado {
  return {
    habilitada: r.habilitada,
    cupoProyectoCop: Number(r.cupo_proyecto_cop),
    cupoUsuarioCop: Number(r.cupo_usuario_cop),
    trm: r.trm === null ? null : Number(r.trm),
    projectName: r.project_name ?? null,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

interface UsoRow {
  id: number;
  project_id: string;
  user_id: string;
  user_name: string;
  tarea: string;
  modelo: string;
  items: number;
  tokens_entrada: number;
  tokens_salida: number;
  tokens_cache_escritura: number;
  tokens_cache_lectura: number;
  costo_usd: number | string;
  trm: number | string;
  costo_cop: number | string;
  version_prompt: string;
  estado: string;
  detalle: string;
  creado: string;
}

function usoDeFila(r: UsoRow): RegistroUsoIA {
  return {
    id: Number(r.id),
    projectId: r.project_id,
    userId: r.user_id,
    userName: r.user_name,
    tarea: r.tarea as TareaIA,
    modelo: r.modelo,
    items: r.items,
    tokensEntrada: r.tokens_entrada,
    tokensSalida: r.tokens_salida,
    tokensCacheEscritura: r.tokens_cache_escritura,
    tokensCacheLectura: r.tokens_cache_lectura,
    costoUsd: Number(r.costo_usd),
    trm: Number(r.trm),
    costoCop: Number(r.costo_cop),
    versionPrompt: r.version_prompt,
    estado: r.estado as RegistroUsoIA["estado"],
    detalle: r.detalle,
    creado: r.creado,
  };
}

interface BorradorRow {
  id: string;
  tarea: string;
  item_id: string;
  referencia: string;
  propuesta: BorradorGenerico["propuesta"];
  anterior: BorradorGenerico["anterior"];
  estado: string;
  editado: boolean;
  final: BorradorGenerico["final"];
  uso_id: number | null;
  creado: string;
  creado_por: string;
  decidido: string | null;
  decidido_por: string | null;
}

function borradorDeFila(r: BorradorRow): BorradorGenerico {
  return {
    id: r.id,
    tarea: r.tarea as TareaIA,
    itemId: r.item_id,
    referencia: r.referencia,
    propuesta: r.propuesta,
    anterior: r.anterior,
    estado: r.estado as EstadoBorrador,
    editado: r.editado,
    final: r.final,
    usoId: r.uso_id === null ? null : Number(r.uso_id),
    creado: r.creado,
    creadoPor: r.creado_por,
    decidido: r.decidido,
    decididoPor: r.decidido_por,
  };
}

function agrupar<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of list) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
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
    let res: Response;
    try {
      res = await fetch(`${rest}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      // Reads are retried by json(); a write that timed out is reported plainly.
      if (esTiempo(err) && init.method && init.method !== "GET") throw new StoreError(LENTA, 504);
      throw err;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    let detail: { code?: string; message?: string } = {};
    try {
      detail = JSON.parse(body);
    } catch {
      // not JSON
    }
    if (/version-conflict/.test(body)) throw new StoreError("version-conflict", 409);
    if (/(memoria|edt|tarea|project_name)/i.test(body) && /PGRST204|42703|column/i.test(body)) throw new StoreError(UPGRADE_HINT);
    if (detail.code === "23505") throw new StoreError("duplicate-code", 409);
    if (/PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body)) throw new StoreError(SETUP_HINT);
    if (res.status === 401 || res.status === 403) {
      throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    if (detail.code && /^(22\w{3}|23514)$/.test(detail.code)) throw new StoreError(detail.message ?? "Valor no válido.", 400);
    throw new StoreError(`Supabase respondió ${res.status}${detail.message ? `: ${detail.message}` : ""}`);
  }

  /** The answer as JSON. A read that runs out of time (sending or receiving) is tried once more. */
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const lectura = !init?.method || init.method === "GET";
    for (let intento = 0; ; intento++) {
      try {
        return (await (await call(path, init)).json()) as T;
      } catch (err) {
        if (!esTiempo(err)) throw err;
        if (lectura && intento === 0) continue;
        throw new StoreError(LENTA, 504);
      }
    }
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
  /** The assistant's tables came later: a missing one means the SQL must be run again. */
  async function ia<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StoreError && err.message === SETUP_HINT) throw new StoreError(UPGRADE_HINT);
      throw err;
    }
  }

  return {
    async getConfig(projectId) {
      type Row = { base_project_id: string; base_project_name: string; editores: Responsable[] | null; memoria_columnas?: ColumnaMemoria[] | null };
      const base = `/presupuesto_config?project_id=${eq(projectId)}&select=base_project_id,base_project_name,editores`;
      let rows: Row[];
      try {
        rows = await json<Row[]>(`${base},memoria_columnas`);
      } catch (err) {
        // Before supabase/presupuesto.sql is run again, the column doesn't exist: the rest keeps working.
        if (!(err instanceof StoreError) || err.message !== UPGRADE_HINT) throw err;
        rows = await json<Row[]>(base);
      }
      if (!rows.length) return null;
      const r = rows[0];
      return {
        baseProjectId: r.base_project_id,
        baseProjectName: r.base_project_name,
        editores: Array.isArray(r.editores) ? r.editores : [],
        ...(Array.isArray(r.memoria_columnas) && r.memoria_columnas.length ? { memoriaColumnas: r.memoria_columnas } : {}),
      };
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
          ...(config.memoriaColumnas !== undefined ? { memoria_columnas: config.memoriaColumnas } : {}),
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
        `/presupuesto_partidas?base_id=${eq(baseId)}&select=id,codigo,descripcion,unidad,rendimiento,jornada,omniclass,componentes,edt,updated_at,updated_by&order=descripcion.asc,id.asc`
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
        `/presupuesto_partidas?base_id=${eq(baseId)}&componentes=cs.${filter}&select=id,codigo,descripcion,unidad,rendimiento,jornada,omniclass,componentes,edt,updated_at,updated_by&limit=20`
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

    async modelosUsados(projectId) {
      let rows: { model_id: string; elementos: number | string }[];
      try {
        rows = await all(`/presupuesto_modelos_usados?project_id=${eq(projectId)}&select=model_id,elementos&order=model_id.asc`);
      } catch (err) {
        // The tables exist; it's this view (added later) that is missing.
        if (err instanceof StoreError && err.message === SETUP_HINT) throw new StoreError(UPGRADE_HINT);
        throw err;
      }
      return rows.map((r) => ({ modelId: r.model_id, elementos: Number(r.elementos) }));
    },

    async saveVista(projectId, userId, vista) {
      const fila = { project_id: projectId, user_id: userId, item_id: vista.itemId, elementos: vista.elementos, creado: new Date().toISOString() };
      const guardar = (body: object) =>
        call("/presupuesto_vistas?on_conflict=project_id,user_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(body),
        });
      try {
        await guardar({ ...fila, tarea: vista.tarea });
      } catch (err) {
        // Before the SQL is updated there is no "tarea" column: seeing elements in 3D keeps working without it.
        if (vista.tarea !== "ver" || !(err instanceof StoreError) || err.message !== UPGRADE_HINT) throw err;
        await guardar(fila);
      }
    },

    async takeVista(projectId, userId, maxMinutos) {
      type Row = { item_id: string; elementos: VistaPendiente["elementos"] | null; creado: string; tarea?: string };
      const base = `/presupuesto_vistas?project_id=${eq(projectId)}&user_id=${eq(userId)}&select=item_id,elementos,creado`;
      let rows: Row[];
      try {
        rows = await json<Row[]>(`${base},tarea`);
      } catch (err) {
        if (!(err instanceof StoreError) || err.message !== UPGRADE_HINT) throw err;
        rows = await json<Row[]>(base);
      }
      if (!rows.length) return null;
      await call(`/presupuesto_vistas?project_id=${eq(projectId)}&user_id=${eq(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      const r = rows[0];
      if (Date.now() - new Date(r.creado).getTime() > maxMinutos * 60_000) return null;
      return { tarea: r.tarea === "memoria" ? "memoria" : "ver", itemId: r.item_id, elementos: Array.isArray(r.elementos) ? r.elementos : [] };
    },

    async getCamposModelo(projectId) {
      const rows = await json<{ leido: string; leido_por: string | null; modelos: string[] | null; campos: CamposModelo["campos"] | null }[]>(
        `/presupuesto_campos_modelo?project_id=${eq(projectId)}&select=leido,leido_por,modelos,campos`
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { leido: r.leido, leidoPor: r.leido_por, modelos: Array.isArray(r.modelos) ? r.modelos : [], campos: Array.isArray(r.campos) ? r.campos : [] };
    },

    async saveCamposModelo(projectId, data, user) {
      await call("/presupuesto_campos_modelo?on_conflict=project_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ project_id: projectId, leido: new Date().toISOString(), leido_por: user, modelos: data.modelos, campos: data.campos }),
      });
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

    async getCupoIA(projectId) {
      return ia(async () => {
        const rows = await json<CupoRow[]>(`/presupuesto_ia_cupos?project_id=${eq(projectId)}&select=*`);
        return rows.length ? cupoDeFila(rows[0]) : null;
      });
    },

    async listarCuposIA() {
      return ia(async () => {
        const rows = await all<CupoRow>(`/presupuesto_ia_cupos?project_id=neq._global&select=*&order=updated_at.desc`);
        return rows.map((r) => ({ ...cupoDeFila(r), projectId: r.project_id }));
      });
    },

    async gastoProyectosIA(desde) {
      return ia(async () => {
        const rows = await json<{ project_id: string; gasto: number | string }[]>("/rpc/presupuesto_ia_gasto_proyectos", {
          method: "POST",
          body: JSON.stringify({ p_desde: desde }),
        });
        return new Map(rows.map((r) => [r.project_id, Number(r.gasto)]));
      });
    },

    async saveCupoIA(projectId, cupo, user) {
      await ia(() =>
        call("/presupuesto_ia_cupos?on_conflict=project_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            project_id: projectId,
            habilitada: cupo.habilitada,
            cupo_proyecto_cop: cupo.cupoProyectoCop,
            cupo_usuario_cop: cupo.cupoUsuarioCop,
            trm: cupo.trm ?? null,
            ...(cupo.projectName ? { project_name: cupo.projectName } : {}),
            updated_at: new Date().toISOString(),
            updated_by: user,
          }),
        })
      );
    },

    async registrarUsoIA(u) {
      return ia(async () => {
        const rows = await json<{ id: number }[]>("/presupuesto_ia_uso?select=id", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            project_id: u.projectId,
            user_id: u.userId,
            user_name: u.userName,
            tarea: u.tarea,
            modelo: u.modelo,
            items: u.items,
            tokens_entrada: u.tokensEntrada,
            tokens_salida: u.tokensSalida,
            tokens_cache_escritura: u.tokensCacheEscritura,
            tokens_cache_lectura: u.tokensCacheLectura,
            costo_usd: u.costoUsd,
            trm: u.trm,
            costo_cop: u.costoCop,
            version_prompt: u.versionPrompt,
            estado: u.estado,
            detalle: u.detalle.slice(0, 500),
          }),
        });
        return rows[0]?.id ?? 0;
      });
    },

    async gastoIA(projectId, desde, userId) {
      return ia(async () => {
        const rows = await json<{ proyecto: number | string; usuario: number | string }[]>("/rpc/presupuesto_ia_gasto", {
          method: "POST",
          body: JSON.stringify({ p_project_id: projectId, p_desde: desde, p_user_id: userId }),
        });
        return { proyecto: Number(rows[0]?.proyecto ?? 0), usuario: Number(rows[0]?.usuario ?? 0) };
      });
    },

    async usosIA(projectId, limite) {
      return ia(async () => {
        const rows = await json<UsoRow[]>(`/presupuesto_ia_uso?project_id=${eq(projectId)}&select=*&order=creado.desc&limit=${limite}`);
        return rows.map(usoDeFila);
      });
    },

    async guardarBorradoresIA(projectId, borradores) {
      if (!borradores.length) return;
      await ia(async () => {
        for (const [tarea, lista] of agrupar(borradores, (b) => b.tarea)) {
          for (const lote of chunks(lista, 200)) {
            await call(
              `/presupuesto_ia_borradores?project_id=${eq(projectId)}&tarea=${eq(tarea)}&estado=eq.pendiente&item_id=${inList(lote.map((b) => b.itemId))}`,
              { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ estado: "reemplazado" }) }
            );
          }
        }
        for (const lote of chunks(borradores, 200)) {
          await call("/presupuesto_ia_borradores", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(
              lote.map((b) => ({
                id: b.id,
                project_id: projectId,
                tarea: b.tarea,
                item_id: b.itemId,
                referencia: b.referencia,
                propuesta: b.propuesta,
                anterior: b.anterior,
                estado: "pendiente",
                uso_id: b.usoId,
                creado_por: b.creadoPor,
              }))
            ),
          });
        }
      });
    },

    async borradoresIA(projectId, filtro) {
      return ia(async () => {
        let path = `/presupuesto_ia_borradores?project_id=${eq(projectId)}&select=*&order=creado.asc`;
        if (filtro.estado) path += `&estado=${eq(filtro.estado)}`;
        if (filtro.tarea) path += `&tarea=${eq(filtro.tarea)}`;
        if (filtro.ids) {
          if (!filtro.ids.length) return [];
          path += `&id=${inList(filtro.ids)}`;
        }
        return (await all<BorradorRow>(path)).map(borradorDeFila);
      });
    },

    async decidirBorradoresIA(projectId, decisiones, user) {
      return ia(async () => {
        let n = 0;
        for (const d of decisiones) {
          const rows = await json<{ id: string }[]>(`/presupuesto_ia_borradores?project_id=${eq(projectId)}&id=${eq(d.id)}&estado=eq.pendiente&select=id`, {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ estado: d.estado, editado: d.editado, final: d.final, decidido: new Date().toISOString(), decidido_por: user }),
          });
          n += rows.length;
        }
        return n;
      });
    },

    async resumenBorradoresIA(projectId) {
      return ia(async () => {
        const rows = await json<{ tarea: string; pendientes: number; aceptados_sin_cambios: number; aceptados_editados: number; rechazados: number }[]>(
          "/rpc/presupuesto_ia_resumen_tareas",
          { method: "POST", body: JSON.stringify({ p_project_id: projectId }) }
        );
        const out: ResumenesIA = {};
        for (const r of rows) {
          out[r.tarea as TareaIA] = {
            pendientes: Number(r.pendientes),
            aceptadosSinCambios: Number(r.aceptados_sin_cambios),
            aceptadosEditados: Number(r.aceptados_editados),
            rechazados: Number(r.rechazados),
          };
        }
        return out;
      });
    },

    async getProgramacion(projectId) {
      try {
        const rows = await json<{ data: unknown; version: number; updated_at: string; updated_by: string | null }[]>(
          `/presupuesto_programacion?project_id=${eq(projectId)}&select=data,version,updated_at,updated_by`
        );
        if (!rows.length) return null;
        const r = rows[0];
        return { data: r.data, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by };
      } catch (err) {
        // The other tables exist; this one came later.
        if (err instanceof StoreError && err.message === SETUP_HINT) throw new StoreError(UPGRADE_HINT);
        throw err;
      }
    },

    async saveProgramacion(projectId, data, version, user) {
      try {
        return await rpc("presupuesto_guardar_programacion", { p_project_id: projectId, p_data: data, p_version: version, p_user: user });
      } catch (err) {
        if (err instanceof StoreError && err.message === "version-conflict") return "conflict";
        if (err instanceof StoreError && err.message === SETUP_HINT) throw new StoreError(UPGRADE_HINT);
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
      type Row = { item_id: string; ifc_guid: string; model_id: string; cantidad: number | null; memoria: Memoria | null };
      const select = "&select=item_id,ifc_guid,model_id,cantidad,memoria&order=id.asc";
      const toEl = (r: Row): ElementoVinculado => ({ itemId: r.item_id, ifcGuid: r.ifc_guid, modelId: r.model_id, cantidad: r.cantidad, memoria: r.memoria ?? null });
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
              memoria: e.memoria,
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
  const programaciones = new Map<string, StoredDocumento>();
  const cuposIA = new Map<string, CupoGuardado>();
  const usosIA: RegistroUsoIA[] = [];
  const borradoresIA = new Map<string, BorradorGenerico & { projectId: string }>();
  const campos = new Map<string, CamposModelo>();
  const vistas = new Map<string, { vista: VistaPendiente; creado: number }>();
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
    async modelosUsados(projectId) {
      const por = new Map<string, number>();
      for (const e of elementos.values()) if (e.projectId === projectId) por.set(e.modelId, (por.get(e.modelId) ?? 0) + 1);
      return [...por].map(([modelId, n]) => ({ modelId, elementos: n }));
    },
    async saveVista(projectId, userId, vista) {
      vistas.set(`${projectId}|${userId}`, { vista, creado: Date.now() });
    },
    async takeVista(projectId, userId, maxMinutos) {
      const k = `${projectId}|${userId}`;
      const v = vistas.get(k);
      vistas.delete(k);
      return v && Date.now() - v.creado <= maxMinutos * 60_000 ? v.vista : null;
    },
    async getCamposModelo(projectId) {
      return campos.get(projectId) ?? null;
    },
    async saveCamposModelo(projectId, data, user) {
      campos.set(projectId, { leido: new Date().toISOString(), leidoPor: user, ...data });
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
    async getCupoIA(projectId) {
      const c = cuposIA.get(projectId);
      return c ? { ...c } : null;
    },
    async saveCupoIA(projectId, cupo, user) {
      const antes = cuposIA.get(projectId);
      cuposIA.set(projectId, { ...cupo, projectName: cupo.projectName ?? antes?.projectName ?? null, updatedAt: new Date().toISOString(), updatedBy: user });
    },
    async listarCuposIA() {
      return [...cuposIA].filter(([id]) => id !== "_global").map(([projectId, c]) => ({ ...c, projectId }));
    },
    async gastoProyectosIA(desde) {
      const d = Date.parse(desde);
      const out = new Map<string, number>();
      for (const u of usosIA) if (Date.parse(u.creado) >= d) out.set(u.projectId, Math.round(((out.get(u.projectId) ?? 0) + u.costoCop) * 100) / 100);
      return out;
    },
    async registrarUsoIA(u) {
      const id = usosIA.length + 1;
      usosIA.push({ ...u, id, creado: new Date().toISOString() });
      return id;
    },
    async gastoIA(projectId, desde, userId) {
      const d = Date.parse(desde);
      const delMes = usosIA.filter((u) => u.projectId === projectId && Date.parse(u.creado) >= d);
      const suma = (l: RegistroUsoIA[]) => Math.round(l.reduce((s, u) => s + u.costoCop, 0) * 100) / 100;
      return { proyecto: suma(delMes), usuario: suma(delMes.filter((u) => u.userId === userId)) };
    },
    async usosIA(projectId, limite) {
      return usosIA.filter((u) => u.projectId === projectId).reverse().slice(0, limite);
    },
    async guardarBorradoresIA(projectId, lista) {
      const items = new Set(lista.map((b) => `${b.tarea}|${b.itemId}`));
      for (const b of borradoresIA.values()) {
        if (b.projectId === projectId && b.estado === "pendiente" && items.has(`${b.tarea}|${b.itemId}`)) b.estado = "reemplazado";
      }
      for (const b of lista) borradoresIA.set(b.id, { ...structuredClone(b), estado: "pendiente", projectId });
    },
    async borradoresIA(projectId, filtro) {
      const ids = filtro.ids ? new Set(filtro.ids) : null;
      return [...borradoresIA.values()]
        .filter((b) => b.projectId === projectId && (!filtro.estado || b.estado === filtro.estado) && (!filtro.tarea || b.tarea === filtro.tarea) && (!ids || ids.has(b.id)))
        .map(({ projectId: _p, ...b }) => structuredClone(b));
    },
    async decidirBorradoresIA(projectId, decisiones, user) {
      let n = 0;
      for (const d of decisiones) {
        const b = borradoresIA.get(d.id);
        if (!b || b.projectId !== projectId || b.estado !== "pendiente") continue;
        Object.assign(b, { estado: d.estado, editado: d.editado, final: d.final, decidido: new Date().toISOString(), decididoPor: user });
        n++;
      }
      return n;
    },
    async resumenBorradoresIA(projectId) {
      const out: ResumenesIA = {};
      for (const b of borradoresIA.values()) {
        if (b.projectId !== projectId || b.estado === "reemplazado") continue;
        const r = (out[b.tarea] ??= { pendientes: 0, aceptadosSinCambios: 0, aceptadosEditados: 0, rechazados: 0 });
        if (b.estado === "pendiente") r.pendientes++;
        else if (b.estado === "rechazado") r.rechazados++;
        else if (b.editado) r.aceptadosEditados++;
        else r.aceptadosSinCambios++;
      }
      return out;
    },
    async getProgramacion(projectId) {
      const d = programaciones.get(projectId);
      return d ? { ...d, data: structuredClone(d.data) } : null;
    },
    async saveProgramacion(projectId, data, version, user) {
      if ((programaciones.get(projectId)?.version ?? 0) !== version) return "conflict";
      programaciones.set(projectId, { data: structuredClone(data), version: version + 1, updatedAt: new Date().toISOString(), updatedBy: user });
      return version + 1;
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
