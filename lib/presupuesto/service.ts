import { isValidProjectId } from "../access";
import { isIfcGuid } from "../propiedades/ifcGuid";
import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { Responsable } from "../propiedades/types";
import { documentoVacio } from "./doc";
import type { PresupuestoStore, StoredConfig } from "./store";
import {
  CatalogoResponse,
  DocumentoResponse,
  ElementoVinculado,
  EstadoResponse,
  MAX_EDITORES,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_IMPORT_ROWS,
  OmniclassEntry,
  PresupuestoDoc,
  ResumenElementos,
} from "./types";
import { idsDePartidas, UUID_RE, validarDocumento, validarInsumo, validarPartida } from "./validate";

/** What the service needs from Trimble Connect besides the caller of the current project. */
export interface Deps {
  /** The caller as a member of another project; throws when they aren't one. */
  callerIn(projectId: string): Promise<Caller>;
  projectName(projectId: string): Promise<string>;
}

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: PresupuestoStore;
  deps: Deps;
}

const MAX_DOC_BYTES = 4_000_000;
const MAX_OMNICLASS = 5000;

function bad(message: string): never {
  throw new ServiceError(message, 400);
}

async function configDe(store: PresupuestoStore, projectId: string): Promise<StoredConfig> {
  return (await store.getConfig(projectId)) ?? { baseProjectId: projectId, baseProjectName: "", editores: [] };
}

/** Administrators, the people named editors, and members of the groups named editors. */
export async function esEditor(caller: Caller, editores: Responsable[]): Promise<boolean> {
  if (caller.isAdmin) return true;
  if (editores.some((r) => r.type === "user" && r.id === caller.id)) return true;
  const groups = editores.filter((r) => r.type === "group").map((r) => r.id);
  if (groups.length && caller.memberOfGroups) return (await caller.memberOfGroups(groups)).size > 0;
  return false;
}

/** Whether the caller can change the catalogs this project uses (they live in its base project). */
async function permisoBase(ctx: Ctx, config: StoredConfig): Promise<{ ok: boolean; note: string }> {
  if (config.baseProjectId === ctx.projectId) {
    const ok = await esEditor(ctx.caller, config.editores);
    return { ok, note: ok ? "" : "Solo los administradores y los editores del presupuesto modifican los catálogos." };
  }
  const nombre = config.baseProjectName || config.baseProjectId;
  const note = `Los catálogos son del proyecto base "${nombre}": los modifican sus administradores y editores.`;
  let enBase: Caller;
  try {
    enBase = await ctx.deps.callerIn(config.baseProjectId);
  } catch {
    return { ok: false, note };
  }
  const ok = await esEditor(enBase, (await configDe(ctx.store, config.baseProjectId)).editores);
  return { ok, note: ok ? "" : note };
}

async function requireEdit(ctx: Ctx): Promise<void> {
  const config = await configDe(ctx.store, ctx.projectId);
  if (!(await esEditor(ctx.caller, config.editores))) {
    throw new ServiceError("Solo los administradores del proyecto y los editores designados pueden modificar el presupuesto.", 403, "not-editor");
  }
}

/** The base project id, if the caller may change its catalogs. */
async function requireEditBase(ctx: Ctx): Promise<string> {
  const config = await configDe(ctx.store, ctx.projectId);
  const permiso = await permisoBase(ctx, config);
  if (!permiso.ok) throw new ServiceError(permiso.note, 403, "not-base-editor");
  return config.baseProjectId;
}

function storeErrors(err: unknown): never {
  if (err instanceof StoreError && err.message === "duplicate-code") {
    throw new ServiceError("Ya existe otro registro con ese código en el catálogo. Los códigos no se pueden repetir.", 409, "duplicate-code");
  }
  throw err;
}

// ---------------------------------------------------------------- state and configuration

export async function getEstado(ctx: Ctx): Promise<EstadoResponse> {
  const config = await configDe(ctx.store, ctx.projectId);
  const [canEdit, base] = await Promise.all([esEditor(ctx.caller, config.editores), permisoBase(ctx, config)]);
  return {
    projectId: ctx.projectId,
    config,
    esBasePropia: config.baseProjectId === ctx.projectId,
    isAdmin: ctx.caller.isAdmin,
    canEdit,
    canEditBase: base.ok,
    baseNote: base.note,
    user: { id: ctx.caller.id, name: ctx.caller.name },
  };
}

function readEditores(value: unknown): Responsable[] {
  if (!Array.isArray(value)) bad("Los editores deben ser una lista.");
  if (value.length > MAX_EDITORES) bad(`Máximo ${MAX_EDITORES} editores.`);
  const seen = new Set<string>();
  const out: Responsable[] = [];
  for (const v of value) {
    const r = v as Partial<Responsable> | null;
    if (!r || (r.type !== "user" && r.type !== "group") || typeof r.id !== "string" || !r.id || r.id.length > 100) {
      bad("Editor no válido.");
    }
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: r.type, id: r.id, name: typeof r.name === "string" ? r.name.slice(0, 200) : r.id });
  }
  return out;
}

/** Administrators choose the editors and the base project (they must belong to it). */
export async function updateConfig(ctx: Ctx, body: unknown): Promise<EstadoResponse> {
  if (!ctx.caller.isAdmin) throw new ServiceError("Solo los administradores del proyecto cambian esta configuración.", 403, "not-admin");
  const o = (body ?? {}) as { baseProjectId?: unknown; editores?: unknown };
  const config = await configDe(ctx.store, ctx.projectId);
  const next: StoredConfig = { ...config };
  if (o.editores !== undefined) next.editores = readEditores(o.editores);
  if (o.baseProjectId !== undefined) {
    const raw = typeof o.baseProjectId === "string" ? o.baseProjectId.trim() : "";
    const base = raw || ctx.projectId;
    if (!isValidProjectId(base)) bad("El id del proyecto base no es válido.");
    if (base === ctx.projectId) {
      next.baseProjectId = ctx.projectId;
      next.baseProjectName = "";
    } else if (base !== config.baseProjectId) {
      // Linking shares the base's catalogs (and prices) with this project's team:
      // only someone who maintains the base can do it.
      let enBase: Caller;
      try {
        enBase = await ctx.deps.callerIn(base);
      } catch {
        throw new ServiceError(
          "No se pudo abrir ese proyecto con tu usuario: para usarlo como base de catálogos debes ser miembro de él.",
          403,
          "not-base-member"
        );
      }
      if (!(await esEditor(enBase, (await configDe(ctx.store, base)).editores))) {
        throw new ServiceError(
          "Para usar ese proyecto como base debes ser administrador o editor del presupuesto en él (así nadie comparte sus precios sin permiso).",
          403,
          "not-base-editor"
        );
      }
      next.baseProjectId = base;
      next.baseProjectName = await ctx.deps.projectName(base).catch(() => "");
    }
  }
  await ctx.store.saveConfig(ctx.projectId, next, ctx.caller.name);
  return getEstado(ctx);
}

// ---------------------------------------------------------------- catalogs

export async function getCatalogo(ctx: Ctx): Promise<CatalogoResponse> {
  const { baseProjectId } = await configDe(ctx.store, ctx.projectId);
  const [insumos, partidas, omniclass] = await Promise.all([
    ctx.store.listInsumos(baseProjectId),
    ctx.store.listPartidas(baseProjectId),
    ctx.store.listOmniclass(baseProjectId),
  ]);
  return { baseProjectId, insumos, partidas, omniclass };
}

function rows(body: unknown, key: string): unknown[] {
  const list = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list) || list.length === 0) bad("No hay nada que guardar.");
  if (list.length > MAX_IMPORT_ROWS) bad(`Máximo ${MAX_IMPORT_ROWS} registros por envío.`);
  return list;
}

function rowId(value: unknown): string {
  const id = (value as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) bad("Registro sin id válido.");
  return id.toLowerCase();
}

function sinCodigosRepetidos(list: { codigo: string }[]) {
  const seen = new Set<string>();
  for (const r of list) {
    const key = r.codigo.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) bad(`El código "${r.codigo}" está repetido.`);
    seen.add(key);
  }
}

export async function guardarInsumos(ctx: Ctx, body: unknown): Promise<{ guardados: number }> {
  const baseId = await requireEditBase(ctx);
  const list = rows(body, "insumos").map((r, i) => ({ id: rowId(r), ...validarInsumo(r, `Insumo ${i + 1}`) }));
  sinCodigosRepetidos(list);
  try {
    return { guardados: await ctx.store.saveInsumos(baseId, list, ctx.caller.name) };
  } catch (err) {
    storeErrors(err);
  }
}

export async function guardarPartidas(ctx: Ctx, body: unknown): Promise<{ guardados: number }> {
  const baseId = await requireEditBase(ctx);
  const list = rows(body, "partidas").map((r, i) => {
    const id = rowId(r);
    const p = validarPartida(r, `Partida ${i + 1}`);
    if (p.componentes.some((c) => c.tipo === "subpartida" && c.id === id)) bad(`"${p.descripcion}" no puede ser subpartida de sí misma.`);
    return { id, ...p };
  });
  sinCodigosRepetidos(list);
  try {
    return { guardados: await ctx.store.savePartidas(baseId, list, ctx.caller.name) };
  } catch (err) {
    storeErrors(err);
  }
}

function enUso(nombre: string, partidas: { descripcion: string }[]): never {
  const lista = partidas.slice(0, 3).map((p) => `"${p.descripcion}"`).join(", ");
  throw new ServiceError(
    `${nombre} se usa en ${partidas.length === 20 ? "20 o más" : partidas.length} partida(s) del catálogo (${lista}${partidas.length > 3 ? "..." : ""}). Quítalo de ellas antes de eliminarlo.`,
    409,
    "in-use"
  );
}

export async function eliminarInsumo(ctx: Ctx, id: string): Promise<void> {
  const baseId = await requireEditBase(ctx);
  if (!UUID_RE.test(id)) bad("Id no válido.");
  const usan = await ctx.store.partidasQueUsan(baseId, id);
  if (usan.length) enUso("El insumo", usan);
  if (!(await ctx.store.deleteInsumo(baseId, id))) throw new ServiceError("El insumo no existe en el catálogo.", 404);
}

export async function eliminarPartida(ctx: Ctx, id: string): Promise<void> {
  const baseId = await requireEditBase(ctx);
  if (!UUID_RE.test(id)) bad("Id no válido.");
  const usan = (await ctx.store.partidasQueUsan(baseId, id)).filter((p) => p.id !== id);
  if (usan.length) enUso("La partida", usan);
  if (!(await ctx.store.deletePartida(baseId, id))) throw new ServiceError("La partida no existe en el catálogo.", 404);
}

export async function guardarOmniclass(ctx: Ctx, body: unknown): Promise<{ guardados: number }> {
  const baseId = await requireEditBase(ctx);
  const list = (body as { entradas?: unknown } | null)?.entradas;
  if (!Array.isArray(list) || list.length === 0) bad("No hay códigos que importar.");
  if (list.length > MAX_OMNICLASS) bad(`Máximo ${MAX_OMNICLASS} códigos por envío.`);
  const entradas: OmniclassEntry[] = list.map((v) => {
    const o = (v ?? {}) as { codigo?: unknown; titulo?: unknown };
    const codigo = typeof o.codigo === "string" ? o.codigo.trim() : "";
    const titulo = typeof o.titulo === "string" ? o.titulo.trim() : "";
    if (!codigo || codigo.length > 60 || !titulo || titulo.length > 300) bad(`Código OmniClass no válido: "${codigo}".`);
    return { codigo, titulo };
  });
  const unicos = [...new Map(entradas.map((e) => [e.codigo, e])).values()];
  return { guardados: await ctx.store.saveOmniclass(baseId, unicos) };
}

// ---------------------------------------------------------------- the budget

export async function getDocumento(ctx: Ctx): Promise<DocumentoResponse> {
  const stored = await ctx.store.getDocumento(ctx.projectId);
  if (!stored) return { doc: documentoVacio(), version: 0, updatedAt: null, updatedBy: null };
  return { doc: stored.data as PresupuestoDoc, version: stored.version, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy };
}

export async function guardarDocumento(ctx: Ctx, body: unknown): Promise<{ version: number }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { doc?: unknown; version?: unknown };
  if (!Number.isInteger(o.version) || (o.version as number) < 0) bad("Falta la versión del presupuesto.");
  const doc = validarDocumento(o.doc);
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) bad("El presupuesto es demasiado grande para guardarlo de una vez.");
  const result = await ctx.store.saveDocumento(ctx.projectId, doc, o.version as number, ctx.caller.name);
  if (result === "conflict") {
    throw new ServiceError(
      "Otra persona guardó el presupuesto mientras lo editabas. Tus cambios siguen en pantalla: recarga para ver los suyos y vuelve a aplicarlos.",
      409,
      "version-conflict"
    );
  }
  return { version: result };
}

// ---------------------------------------------------------------- model elements

export async function getResumen(ctx: Ctx): Promise<ResumenElementos> {
  const [mediciones, resumen] = await Promise.all([ctx.store.listMediciones(ctx.projectId), ctx.store.resumenElementos(ctx.projectId)]);
  return { mediciones, resumen };
}

function stringList(value: unknown, what: string, check: (s: string) => boolean): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(`${what}: se esperaba una lista.`);
  if (value.length > MAX_ELEMENTS_PER_REQUEST) bad(`${what}: máximo ${MAX_ELEMENTS_PER_REQUEST} por consulta.`);
  for (const v of value) if (typeof v !== "string" || !check(v)) bad(`${what}: valor no válido.`);
  return [...new Set(value as string[])];
}

const ITEM_ID = (s: string) => /^[A-Za-z0-9-]{1,64}$/.test(s);

export async function consultarElementos(ctx: Ctx, body: unknown): Promise<{ elementos: ElementoVinculado[] }> {
  const o = (body ?? {}) as { itemIds?: unknown; ifcGuids?: unknown };
  const itemIds = stringList(o.itemIds, "Partidas", ITEM_ID);
  const ifcGuids = stringList(o.ifcGuids, "Elementos", isIfcGuid);
  const elementos = [
    ...(itemIds.length ? await ctx.store.getElementos(ctx.projectId, { itemIds }) : []),
    ...(ifcGuids.length ? await ctx.store.getElementos(ctx.projectId, { ifcGuids }) : []),
  ];
  return { elementos };
}

async function requirePartidaGuardada(ctx: Ctx, itemId: unknown): Promise<string> {
  if (typeof itemId !== "string" || !ITEM_ID(itemId)) bad("Falta la partida.");
  const stored = await ctx.store.getDocumento(ctx.projectId);
  if (!stored || !idsDePartidas(stored.data as PresupuestoDoc).has(itemId)) {
    bad("Esa partida no está en el presupuesto guardado. Guarda el presupuesto en el menú del proyecto y vuelve a intentarlo.");
  }
  return itemId;
}

export async function guardarElementos(ctx: Ctx, body: unknown): Promise<{ ok: true }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { itemId?: unknown; upsert?: unknown; remove?: unknown };
  const itemId = await requirePartidaGuardada(ctx, o.itemId);
  const upsertRaw = o.upsert ?? [];
  if (!Array.isArray(upsertRaw)) bad("Elementos: se esperaba una lista.");
  if (upsertRaw.length > MAX_ELEMENTS_PER_REQUEST) bad(`Máximo ${MAX_ELEMENTS_PER_REQUEST} elementos por envío.`);
  const upsert = upsertRaw.map((v) => {
    const e = (v ?? {}) as { ifcGuid?: unknown; modelId?: unknown; cantidad?: unknown };
    if (typeof e.ifcGuid !== "string" || !isIfcGuid(e.ifcGuid)) bad("Elemento sin IFCGUID válido.");
    if (typeof e.modelId !== "string" || !e.modelId || e.modelId.length > 100) bad("Elemento sin modelo.");
    const cantidad = e.cantidad === null || e.cantidad === undefined ? null : Number(e.cantidad);
    if (cantidad !== null && !Number.isFinite(cantidad)) bad("Cantidad de elemento no válida.");
    return { ifcGuid: e.ifcGuid, modelId: e.modelId, cantidad };
  });
  const remove = stringList(o.remove, "Quitar", isIfcGuid);
  await ctx.store.saveElementos(ctx.projectId, itemId, upsert, remove, ctx.caller.name);
  return { ok: true };
}

export async function guardarMedicion(ctx: Ctx, body: unknown): Promise<{ ok: true }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { itemId?: unknown; campo?: unknown; campoLabel?: unknown; unidad?: unknown };
  const itemId = await requirePartidaGuardada(ctx, o.itemId);
  if (o.campo !== null && (typeof o.campo !== "string" || !o.campo || o.campo.length > 300)) bad("Medición no válida.");
  await ctx.store.saveMedicion(
    ctx.projectId,
    {
      itemId,
      campo: o.campo as string | null,
      campoLabel: typeof o.campoLabel === "string" ? o.campoLabel.slice(0, 300) : "",
      unidad: typeof o.unidad === "string" ? o.unidad.slice(0, 20) : "",
    },
    ctx.caller.name
  );
  return { ok: true };
}
