import { isIfcGuid } from "../propiedades/ifcGuid";
import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { Responsable } from "../propiedades/types";
import { plegar } from "../presupuesto/format";
import { reglaDesdeClase } from "./clasificacion";
import { ETAPAS_SUGERIDAS } from "./matriz";
import { codigoLibre, contenidoPlantilla, elementosDePlantilla } from "./plantillas";
import { VALORES_BASURA_INICIALES } from "./reglas";
import { disciplinasSugeridas, TDI_INICIALES } from "./semilla";
import type { ConVersion, ImagenGuardada, LoinStore, StoredConfig } from "./store";
import {
  CamposModelo,
  MAX_ASOCIACIONES_POR_ENVIO,
  MAX_CAMPOS_MODELO,
  ModeloDisciplina,
  VisorResponse,
  CatalogoResponse,
  CeldaData,
  CeldaMatriz,
  Etapa,
  MatrizResponse,
  MAX_CELDAS_POR_ENVIO,
  ConfigLoin,
  Disciplina,
  Elemento,
  ElementosResponse,
  EstadoResponse,
  GrupoTdi,
  Imagen,
  MAX_BYTES_IMAGEN,
  MAX_ELEMENTOS_PLANTILLA,
  MAX_IMAGENES_ELEMENTO,
  MAX_LADO_IMAGEN,
  MAX_PARAMETROS_CATALOGO,
  MAX_PARAMETROS_POR_ENVIO,
  Parametro,
  ParametroData,
  Plantilla,
} from "./types";
import {
  bad,
  leerCelda,
  leerEtapa,
  leerDisciplina,
  leerEditores,
  leerElemento,
  leerGruposTdi,
  leerId,
  leerParametro,
  leerUmbral,
  leerValoresBasura,
  leerVersion,
} from "./validate";

/** What the service needs from Trimble Connect besides the caller of the current project. */
export interface Deps {
  /** The caller as a member of another project; throws when they aren't one. */
  callerIn(projectId: string): Promise<Caller>;
  projectName(projectId: string): Promise<string>;
  /** New ids (tests fix them). */
  nuevoId?: () => string;
}

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: LoinStore;
  deps: Deps;
}

// Same rule as isValidProjectId (lib/access), which is server-only; this module also runs in the local preview.
const PROYECTO_RE = /^[A-Za-z0-9_-]{4,64}$/;

/** How long the image links handed to the browser work. */
const URL_SEGUNDOS = 3600;
const UMBRAL_INICIAL = 50;

const nuevoId = (ctx: Ctx) => (ctx.deps.nuevoId ?? (() => globalThis.crypto.randomUUID()))();

/** The store's refusals, in words of the tool. */
export function traducir(err: unknown): unknown {
  if (!(err instanceof StoreError)) return err;
  if (err.message === "version-conflict") {
    return new ServiceError(
      "Otra persona guardó este registro mientras lo editabas. Tus cambios siguen en pantalla: recarga para ver los suyos y vuelve a aplicarlos.",
      409,
      "version-conflict"
    );
  }
  if (err.message === "duplicate-code") return new ServiceError("Ya existe otro registro con ese código. Los códigos no se pueden repetir.", 409, "duplicate-code");
  if (err.message === "disciplina-ajena") return new ServiceError("Esa disciplina, elemento o etapa no es de este proyecto.", 400, "disciplina-ajena");
  return err;
}

async function guardando<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    throw traducir(err);
  }
}

async function configDe(store: LoinStore, projectId: string): Promise<StoredConfig> {
  return (await store.getConfig(projectId)) ?? { baseProjectId: projectId, baseProjectName: "", editores: [], valoresBasura: null, umbralAmarillo: null };
}

function configPublica(c: StoredConfig): ConfigLoin {
  return {
    baseProjectId: c.baseProjectId,
    baseProjectName: c.baseProjectName,
    editores: c.editores,
    valoresBasura: c.valoresBasura ?? VALORES_BASURA_INICIALES,
    umbralAmarillo: c.umbralAmarillo ?? UMBRAL_INICIAL,
  };
}

/** Administrators, the people named editors, and members of the groups named editors. */
export async function esEditor(caller: Caller, editores: Responsable[]): Promise<boolean> {
  if (caller.isAdmin) return true;
  if (editores.some((r) => r.type === "user" && r.id === caller.id)) return true;
  const groups = editores.filter((r) => r.type === "group").map((r) => r.id);
  if (groups.length && caller.memberOfGroups) return (await caller.memberOfGroups(groups)).size > 0;
  return false;
}

/** Whether the caller can change the catalog this project uses (it lives in its base project). */
async function permisoBase(ctx: Ctx, config: StoredConfig): Promise<{ ok: boolean; note: string }> {
  if (config.baseProjectId === ctx.projectId) {
    const ok = await esEditor(ctx.caller, config.editores);
    return { ok, note: ok ? "" : "Solo los administradores y los editores de Requisitos BIM modifican el catálogo de parámetros." };
  }
  const nombre = config.baseProjectName || config.baseProjectId;
  const note = `El catálogo de parámetros es del proyecto base "${nombre}": lo modifican sus administradores y editores.`;
  let enBase: Caller;
  try {
    enBase = await ctx.deps.callerIn(config.baseProjectId);
  } catch {
    return { ok: false, note };
  }
  const ok = await esEditor(enBase, (await configDe(ctx.store, config.baseProjectId)).editores);
  return { ok, note: ok ? "" : note };
}

async function requireEdit(ctx: Ctx): Promise<StoredConfig> {
  const config = await configDe(ctx.store, ctx.projectId);
  if (!(await esEditor(ctx.caller, config.editores))) {
    throw new ServiceError("Solo los administradores del proyecto y los editores designados pueden modificar los requisitos BIM.", 403, "not-editor");
  }
  return config;
}

/** The base project id, if the caller may change its catalog. */
async function requireEditBase(ctx: Ctx): Promise<string> {
  const config = await configDe(ctx.store, ctx.projectId);
  const permiso = await permisoBase(ctx, config);
  if (!permiso.ok) throw new ServiceError(permiso.note, 403, "not-base-editor");
  return config.baseProjectId;
}

async function gruposDe(store: LoinStore, baseId: string): Promise<GrupoTdi[]> {
  return (await store.getGruposTdi(baseId)) ?? TDI_INICIALES;
}

// ---------------------------------------------------------------- state and configuration

export async function getEstado(ctx: Ctx): Promise<EstadoResponse> {
  const config = await configDe(ctx.store, ctx.projectId);
  const [canEdit, base, tdiGrupos] = await Promise.all([esEditor(ctx.caller, config.editores), permisoBase(ctx, config), gruposDe(ctx.store, config.baseProjectId)]);
  return {
    projectId: ctx.projectId,
    config: configPublica(config),
    tdiGrupos,
    esBasePropia: config.baseProjectId === ctx.projectId,
    isAdmin: ctx.caller.isAdmin,
    canEdit,
    canEditBase: base.ok,
    baseNote: base.note,
    imagenesDisponibles: ctx.store.archivos.disponible,
    user: { id: ctx.caller.id, name: ctx.caller.name },
  };
}

/** Administrators choose the editors and the base project; editors, the garbage values and the yellow threshold. */
export async function updateConfig(ctx: Ctx, body: unknown): Promise<EstadoResponse> {
  const o = (body ?? {}) as { baseProjectId?: unknown; editores?: unknown; valoresBasura?: unknown; umbralAmarillo?: unknown };
  const config = await configDe(ctx.store, ctx.projectId);
  if ((o.baseProjectId !== undefined || o.editores !== undefined) && !ctx.caller.isAdmin) {
    throw new ServiceError("Solo los administradores del proyecto cambian los editores y el proyecto base.", 403, "not-admin");
  }
  if ((o.valoresBasura !== undefined || o.umbralAmarillo !== undefined) && !(await esEditor(ctx.caller, config.editores))) {
    throw new ServiceError("Solo los administradores y editores cambian los valores de relleno y el umbral.", 403, "not-editor");
  }
  const next: StoredConfig = { ...config };
  if (o.editores !== undefined) next.editores = leerEditores(o.editores);
  if (o.valoresBasura !== undefined) next.valoresBasura = o.valoresBasura === null ? null : leerValoresBasura(o.valoresBasura);
  if (o.umbralAmarillo !== undefined) next.umbralAmarillo = o.umbralAmarillo === null ? null : leerUmbral(o.umbralAmarillo);
  if (o.baseProjectId !== undefined) {
    const raw = typeof o.baseProjectId === "string" ? o.baseProjectId.trim() : "";
    const base = raw || ctx.projectId;
    if (!PROYECTO_RE.test(base)) bad("El id del proyecto base no es válido.");
    if (base === ctx.projectId) {
      next.baseProjectId = ctx.projectId;
      next.baseProjectName = "";
    } else if (base !== config.baseProjectId) {
      // Linking shares the base's catalog with this project's team: only someone who maintains it can do it.
      let enBase: Caller;
      try {
        enBase = await ctx.deps.callerIn(base);
      } catch {
        throw new ServiceError("No se pudo abrir ese proyecto con tu usuario: para usarlo como base del catálogo debes ser miembro de él.", 403, "not-base-member");
      }
      if (!(await esEditor(enBase, (await configDe(ctx.store, base)).editores))) {
        throw new ServiceError("Para usar ese proyecto como base debes ser administrador o editor de Requisitos BIM en él.", 403, "not-base-editor");
      }
      next.baseProjectId = base;
      next.baseProjectName = await ctx.deps.projectName(base).catch(() => "");
    }
  }
  await ctx.store.saveConfig(ctx.projectId, next, ctx.caller.name);
  return getEstado(ctx);
}

/** The TDI group names belong to the catalog; a letter some parameter uses can't be removed. */
export async function guardarGruposTdi(ctx: Ctx, body: unknown): Promise<{ tdiGrupos: GrupoTdi[] }> {
  const baseId = await requireEditBase(ctx);
  const grupos = leerGruposTdi((body as { grupos?: unknown } | null)?.grupos);
  const letras = new Set(grupos.map((g) => g.codigo));
  const usadas = new Map<string, number>();
  for (const p of await ctx.store.listParametros(baseId)) if (!letras.has(p.tdi)) usadas.set(p.tdi, (usadas.get(p.tdi) ?? 0) + 1);
  if (usadas.size) {
    const [letra, n] = [...usadas][0];
    bad(`No se puede quitar el grupo TDI-${letra}: lo usan ${n} parámetro(s) del catálogo. Cámbiales el grupo primero.`);
  }
  await ctx.store.saveGruposTdi(baseId, grupos, ctx.caller.name);
  return { tdiGrupos: grupos };
}

// ---------------------------------------------------------------- the parameter catalog

export async function getCatalogo(ctx: Ctx): Promise<CatalogoResponse> {
  const { baseProjectId } = await configDe(ctx.store, ctx.projectId);
  const [parametros, tdiGrupos] = await Promise.all([ctx.store.listParametros(baseProjectId), gruposDe(ctx.store, baseProjectId)]);
  return { baseProjectId, parametros, tdiGrupos };
}

/** Creates or changes parameters (all or none). They are never deleted: `activo: false` takes one out of use. */
export async function guardarParametros(ctx: Ctx, body: unknown): Promise<{ parametros: Parametro[] }> {
  const baseId = await requireEditBase(ctx);
  const list = (body as { parametros?: unknown } | null)?.parametros;
  if (!Array.isArray(list) || list.length === 0) bad("No hay parámetros que guardar.");
  if (list.length > MAX_PARAMETROS_POR_ENVIO) bad(`Máximo ${MAX_PARAMETROS_POR_ENVIO} parámetros por envío.`);
  const filas: ConVersion<ParametroData>[] = list.map((v, i) => {
    const o = (v ?? {}) as { id?: unknown; version?: unknown };
    return { ...leerParametro(v, `Parámetro ${i + 1}`), id: leerId(o.id, `Parámetro ${i + 1}`), version: leerVersion(o.version) };
  });
  const ids = new Set<string>();
  const codigos = new Set<string>();
  for (const f of filas) {
    if (ids.has(f.id)) bad(`El parámetro "${f.nombre}" viene dos veces en el envío.`);
    ids.add(f.id);
    const c = f.codigo.trim().toLowerCase();
    if (codigos.has(c)) bad(`El código "${f.codigo}" está repetido.`);
    codigos.add(c);
  }
  const [grupos, actuales] = await Promise.all([gruposDe(ctx.store, baseId), ctx.store.listParametros(baseId)]);
  const letras = new Set(grupos.map((g) => g.codigo));
  const sinGrupo = filas.find((f) => !letras.has(f.tdi));
  if (sinGrupo) bad(`El grupo TDI-${sinGrupo.tdi} de "${sinGrupo.nombre}" no existe: agrégalo en ⚙ Configuración.`);
  const nuevos = filas.filter((f) => f.version === 0).length;
  if (actuales.length + nuevos > MAX_PARAMETROS_CATALOGO) bad(`El catálogo admite hasta ${MAX_PARAMETROS_CATALOGO} parámetros.`);
  return { parametros: await guardando(ctx.store.saveParametros(baseId, filas, ctx.caller.name)) };
}

// ---------------------------------------------------------------- disciplines and elements

async function conUrls(ctx: Ctx, imagenes: ImagenGuardada[]): Promise<Imagen[]> {
  let urls = new Map<string, string>();
  if (imagenes.length) {
    try {
      urls = await ctx.store.archivos.firmar(imagenes.map((i) => i.ruta), URL_SEGUNDOS);
    } catch {
      // Without the links the images just don't show; the rest of the screen still works.
    }
  }
  return imagenes.map(({ ruta, ...i }) => ({ ...i, url: urls.get(ruta) ?? "" }));
}

export async function getElementos(ctx: Ctx): Promise<ElementosResponse> {
  const [disciplinas, elementos, imagenes] = await Promise.all([
    ctx.store.listDisciplinas(ctx.projectId),
    ctx.store.listElementos(ctx.projectId),
    ctx.store.listImagenes(ctx.projectId),
  ]);
  return { disciplinas, elementos, imagenes: await conUrls(ctx, imagenes) };
}

function conId(body: unknown): { id: string; version: number } {
  const o = (body ?? {}) as { id?: unknown; version?: unknown };
  return { id: leerId(o.id), version: leerVersion(o.version) };
}

/** Creates (version 0) or changes a discipline; to take one out of use, `activo: false`. */
export async function guardarDisciplina(ctx: Ctx, body: unknown): Promise<{ disciplina: Disciplina }> {
  await requireEdit(ctx);
  const fila = { ...leerDisciplina(body), ...conId(body) };
  return { disciplina: await guardando(ctx.store.saveDisciplina(ctx.projectId, fila, ctx.caller.name)) };
}

/** Creates or changes an element; its required parameters must be in the project's catalog. */
export async function guardarElemento(ctx: Ctx, body: unknown): Promise<{ elemento: Elemento }> {
  const config = await requireEdit(ctx);
  const fila = { ...leerElemento(body), ...conId(body) };
  if (fila.parametros.length) {
    const catalogo = new Set((await ctx.store.listParametros(config.baseProjectId)).map((p) => p.id));
    const ajeno = fila.parametros.find((p) => !catalogo.has(p.parametroId));
    if (ajeno) bad("Uno de los parámetros exigidos no está en el catálogo de este proyecto. Recarga la página.");
  }
  return { elemento: await guardando(ctx.store.saveElemento(ctx.projectId, fila, ctx.caller.name)) };
}

/** Adds the starter disciplines whose code the project doesn't use yet, with their elements. */
export async function cargarSugeridas(ctx: Ctx): Promise<{ disciplinas: number; elementos: number; yaExistian: string[] }> {
  const config = await requireEdit(ctx);
  const [actuales, parametros] = await Promise.all([ctx.store.listDisciplinas(ctx.projectId), ctx.store.listParametros(config.baseProjectId)]);
  const usados = new Set(actuales.map((d) => plegar(d.codigo)));
  const porCodigo = new Map(parametros.filter((p) => p.activo).map((p) => [plegar(p.codigo), p.id]));
  let orden = Math.max(0, ...actuales.map((d) => d.orden));
  let disciplinas = 0;
  let elementos = 0;
  const yaExistian: string[] = [];
  for (const s of disciplinasSugeridas()) {
    if (usados.has(plegar(s.codigo))) {
      yaExistian.push(s.codigo);
      continue;
    }
    const d = await guardando(
      ctx.store.saveDisciplina(ctx.projectId, { id: nuevoId(ctx), version: 0, codigo: s.codigo, nombre: s.nombre, color: s.color, orden: ++orden, activo: true }, ctx.caller.name)
    );
    disciplinas++;
    for (const [i, e] of s.elementos.entries()) {
      const exigidos = (e.parametros ?? []).flatMap((c) => {
        const id = porCodigo.get(plegar(c));
        return id ? [{ parametroId: id, obligatorio: true, ndi: null, regla: null }] : [];
      });
      await guardando(
        ctx.store.saveElemento(
          ctx.projectId,
          {
            id: nuevoId(ctx),
            version: 0,
            disciplinaId: d.id,
            codigo: e.codigo,
            nombre: e.nombre,
            claseIfc: e.claseIfc,
            tipoPredefinido: e.tipoPredefinido ?? "",
            clasificacionSistema: "",
            clasificacionCodigo: "",
            notas: e.notas ?? "",
            parametros: exigidos,
            // A starting rule by IFC class, only when no other element of the discipline has that class.
            regla: s.elementos.filter((x) => x.claseIfc === e.claseIfc).length === 1 ? reglaDesdeClase(e.claseIfc) : null,
            orden: i + 1,
            activo: true,
          },
          ctx.caller.name
        )
      );
      elementos++;
    }
  }
  return { disciplinas, elementos, yaExistian };
}

// ---------------------------------------------------------------- stages and the LOIN matrix

export async function getMatriz(ctx: Ctx): Promise<MatrizResponse> {
  const [etapas, celdas] = await Promise.all([ctx.store.listEtapas(ctx.projectId), ctx.store.listMatriz(ctx.projectId)]);
  return { etapas, celdas };
}

/** Creates (version 0) or changes a stage; to take one out of use, `activo: false`. */
export async function guardarEtapa(ctx: Ctx, body: unknown): Promise<{ etapa: Etapa }> {
  await requireEdit(ctx);
  const fila = { ...leerEtapa(body), ...conId(body) };
  return { etapa: await guardando(ctx.store.saveEtapa(ctx.projectId, fila, ctx.caller.name)) };
}

/** Adds the usual stages whose code the project doesn't use yet. */
export async function cargarEtapasSugeridas(ctx: Ctx): Promise<{ etapas: number; yaExistian: string[] }> {
  await requireEdit(ctx);
  const actuales = await ctx.store.listEtapas(ctx.projectId);
  const usados = new Set(actuales.map((e) => plegar(e.codigo)));
  let orden = Math.max(0, ...actuales.map((e) => e.orden));
  let etapas = 0;
  const yaExistian: string[] = [];
  for (const s of ETAPAS_SUGERIDAS) {
    if (usados.has(plegar(s.codigo))) {
      yaExistian.push(s.codigo);
      continue;
    }
    await guardando(ctx.store.saveEtapa(ctx.projectId, { id: nuevoId(ctx), version: 0, codigo: s.codigo, nombre: s.nombre, fecha: null, orden: ++orden, activo: true }, ctx.caller.name));
    etapas++;
  }
  return { etapas, yaExistian };
}

/** Saves cells of the matrix (all or none). Cells are never deleted: without LOD and NDI they require nothing. */
export async function guardarMatriz(ctx: Ctx, body: unknown): Promise<{ celdas: CeldaMatriz[] }> {
  await requireEdit(ctx);
  const list = (body as { celdas?: unknown } | null)?.celdas;
  if (!Array.isArray(list) || list.length === 0) bad("No hay celdas que guardar.");
  if (list.length > MAX_CELDAS_POR_ENVIO) bad(`Máximo ${MAX_CELDAS_POR_ENVIO} celdas por envío.`);
  const filas: ConVersion<CeldaData>[] = list.map((v, i) => ({ ...leerCelda(v, `Celda ${i + 1}`), ...conId(v) }));
  const vistas = new Set<string>();
  for (const f of filas) {
    for (const k of [`id:${f.id}`, `celda:${f.elementoId}|${f.etapaId}`]) {
      if (vistas.has(k)) bad("Una celda de la matriz viene dos veces en el envío.");
      vistas.add(k);
    }
  }
  return { celdas: await guardando(ctx.store.saveMatriz(ctx.projectId, filas, ctx.caller.name)) };
}

// ---------------------------------------------------------------- the models (3D viewer)

/** The models' disciplines and the objects linked by hand (any member may see them). */
export async function getVisor(ctx: Ctx): Promise<VisorResponse> {
  const [modelos, asociaciones] = await Promise.all([ctx.store.listModelos(ctx.projectId), ctx.store.listAsociaciones(ctx.projectId)]);
  return { modelos, asociaciones };
}

const FILE_ID = /^[A-Za-z0-9_.-]{1,100}$/;

/** Which disciplines a model file belongs to (an empty list takes it out of the classification). */
export async function guardarModelo(ctx: Ctx, body: unknown): Promise<{ modelo: ModeloDisciplina }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { fileId?: unknown; nombre?: unknown; disciplinaIds?: unknown };
  if (typeof o.fileId !== "string" || !FILE_ID.test(o.fileId)) bad("Modelo no válido.");
  const nombre = typeof o.nombre === "string" ? o.nombre.trim().slice(0, 200) : "";
  if (!Array.isArray(o.disciplinaIds) || o.disciplinaIds.length > 30) bad("Las disciplinas del modelo deben ser una lista.");
  const ids = [...new Set(o.disciplinaIds.map((d) => leerId(d, "Disciplina")))];
  const propias = new Set((await ctx.store.listDisciplinas(ctx.projectId)).map((d) => d.id));
  if (ids.some((d) => !propias.has(d))) bad("Una de las disciplinas no es de este proyecto.");
  return { modelo: await ctx.store.saveModelo(ctx.projectId, { fileId: o.fileId, nombre, disciplinaIds: ids }, ctx.caller.name) };
}

/** Links objects (by IFCGUID) to an element by hand, or unlinks them (`elementoId: null`). */
export async function asociar(ctx: Ctx, body: unknown): Promise<{ asociados: number }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { elementoId?: unknown; objetos?: unknown };
  const elementoId = o.elementoId === null ? null : leerId(o.elementoId, "Elemento");
  if (!Array.isArray(o.objetos) || o.objetos.length === 0) bad("No hay objetos que asociar.");
  if (o.objetos.length > MAX_ASOCIACIONES_POR_ENVIO) bad(`Máximo ${MAX_ASOCIACIONES_POR_ENVIO} objetos por envío.`);
  const vistos = new Set<string>();
  const objetos = o.objetos.flatMap((x) => {
    const v = (x ?? {}) as { ifcGuid?: unknown; fileId?: unknown };
    if (typeof v.ifcGuid !== "string" || !isIfcGuid(v.ifcGuid)) bad("Un objeto no tiene un IFCGUID válido.");
    if (typeof v.fileId !== "string" || !FILE_ID.test(v.fileId)) bad("Un objeto no tiene modelo.");
    if (vistos.has(v.ifcGuid)) return [];
    vistos.add(v.ifcGuid);
    return [{ ifcGuid: v.ifcGuid, fileId: v.fileId }];
  });
  if (elementoId) {
    const e = (await ctx.store.listElementos(ctx.projectId)).find((x) => x.id === elementoId);
    if (!e) bad("Ese elemento no es de este proyecto.");
    if (!e.activo) bad("Ese elemento está desactivado: actívalo antes de asociarle objetos.");
  }
  return { asociados: await guardando(ctx.store.asociar(ctx.projectId, elementoId, objetos, ctx.caller.name)) };
}

export async function getCamposModelo(ctx: Ctx): Promise<{ campos: CamposModelo | null }> {
  return { campos: await ctx.store.getCamposModelo(ctx.projectId) };
}

/** The group and property names read from the loaded models (read in the viewer, used from the project's menu). */
export async function guardarCamposModelo(ctx: Ctx, body: unknown): Promise<{ guardados: number }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { modelos?: unknown; campos?: unknown };
  if (!Array.isArray(o.modelos) || !Array.isArray(o.campos)) bad("Faltan los modelos o las propiedades leídas.");
  if (o.campos.length === 0) bad("No se encontraron propiedades en los modelos.");
  if (o.campos.length > MAX_CAMPOS_MODELO) bad(`Máximo ${MAX_CAMPOS_MODELO} propiedades.`);
  const modelos = o.modelos.slice(0, 100).map((m) => (typeof m === "string" ? m.slice(0, 200) : bad("Modelo no válido.")));
  const campos = o.campos.map((x) => {
    const c = (x ?? {}) as { grupo?: unknown; propiedad?: unknown; cuenta?: unknown };
    if (typeof c.grupo !== "string" || typeof c.propiedad !== "string" || !c.propiedad.trim()) bad("Propiedad leída no válida.");
    const cuenta = Number.isInteger(c.cuenta) && (c.cuenta as number) >= 0 ? (c.cuenta as number) : 0;
    return { grupo: c.grupo.trim().slice(0, 200), propiedad: c.propiedad.trim().slice(0, 200), cuenta };
  });
  await ctx.store.saveCamposModelo(ctx.projectId, { modelos, campos }, ctx.caller.name);
  return { guardados: campos.length };
}

// ---------------------------------------------------------------- reference images

const TIPOS_IMAGEN: Record<string, { ext: string; firma: (b: Uint8Array) => boolean }> = {
  "image/webp": { ext: "webp", firma: (b) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
  "image/jpeg": { ext: "jpg", firma: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", firma: (b) => b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x) },
};

const extension = (tipo: string) => TIPOS_IMAGEN[tipo]?.ext ?? "img";

/** Stores an image of an element (already reduced in the browser) in the private bucket. */
export async function subirImagen(ctx: Ctx, datos: { elementoId: unknown; nombre: unknown; ancho: unknown; alto: unknown; tipo: string }, contenido: Uint8Array): Promise<{ imagen: Imagen }> {
  await requireEdit(ctx);
  if (!ctx.store.archivos.disponible) bad("El servidor no tiene dónde guardar imágenes (falta Supabase).");
  const elementoId = leerId(datos.elementoId, "Elemento");
  const tipo = datos.tipo.split(";")[0].trim().toLowerCase();
  const formato = TIPOS_IMAGEN[tipo];
  if (!formato) bad("Solo se aceptan imágenes PNG, JPG o WebP.");
  if (contenido.length === 0) bad("La imagen está vacía.");
  if (contenido.length > MAX_BYTES_IMAGEN) bad(`La imagen pesa más de ${Math.round(MAX_BYTES_IMAGEN / 1_000_000)} MB aun reducida; usa una más pequeña.`);
  if (!formato.firma(contenido)) bad("El archivo no es una imagen válida del tipo indicado.");
  const ancho = Number(datos.ancho);
  const alto = Number(datos.alto);
  if (![ancho, alto].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_LADO_IMAGEN)) bad(`Las medidas de la imagen no son válidas (máximo ${MAX_LADO_IMAGEN} px por lado).`);
  const nombre = (typeof datos.nombre === "string" ? datos.nombre : "").replace(/[\u0000-\u001f\\/]+/g, " ").trim().slice(0, 120) || "imagen";

  const [elementos, imagenes] = await Promise.all([ctx.store.listElementos(ctx.projectId), ctx.store.listImagenes(ctx.projectId)]);
  if (!elementos.some((e) => e.id === elementoId)) bad("Ese elemento no es de este proyecto.");
  if (imagenes.filter((i) => i.elementoId === elementoId).length >= MAX_IMAGENES_ELEMENTO) bad(`Cada elemento admite hasta ${MAX_IMAGENES_ELEMENTO} imágenes.`);

  const id = nuevoId(ctx);
  const ruta = `${ctx.projectId}/${elementoId}/${id}.${formato.ext}`;
  await ctx.store.archivos.subir(ruta, contenido, tipo);
  let guardada: ImagenGuardada;
  try {
    guardada = await guardando(ctx.store.addImagen(ctx.projectId, { id, elementoId, ruta, nombre, tipo, ancho, alto, bytes: contenido.length, subidaPor: ctx.caller.name }));
  } catch (err) {
    await ctx.store.archivos.borrar([ruta]).catch(() => undefined);
    throw err;
  }
  const [imagen] = await conUrls(ctx, [guardada]);
  return { imagen };
}

/** Removes an image (it is a picture, not a requirement: it can be removed). */
export async function eliminarImagen(ctx: Ctx, id: string): Promise<void> {
  await requireEdit(ctx);
  const imagen = await ctx.store.deleteImagen(ctx.projectId, leerId(id));
  if (!imagen) throw new ServiceError("La imagen no existe en este proyecto.", 404);
  // A file left behind is harmless; a row pointing to no file is not, hence this order.
  await ctx.store.archivos.borrar([imagen.ruta]).catch(() => undefined);
}

// ---------------------------------------------------------------- templates

export async function listPlantillas(ctx: Ctx): Promise<{ plantillas: Plantilla[] }> {
  const { baseProjectId } = await configDe(ctx.store, ctx.projectId);
  return { plantillas: await ctx.store.listPlantillas(baseProjectId) };
}

/** Saves a discipline of this project, whole, as a template of the catalog's base project. */
export async function crearPlantilla(ctx: Ctx, body: unknown): Promise<{ plantilla: Plantilla; imagenesOmitidas: number }> {
  const baseId = await requireEditBase(ctx);
  const o = (body ?? {}) as { disciplinaId?: unknown; nombre?: unknown; descripcion?: unknown };
  const disciplinaId = leerId(o.disciplinaId, "Disciplina");
  const nombre = typeof o.nombre === "string" ? o.nombre.trim().slice(0, 120) : "";
  if (!nombre) bad("Falta el nombre de la plantilla.");
  const descripcion = typeof o.descripcion === "string" ? o.descripcion.trim().slice(0, 1000) : "";
  const [disciplinas, elementos, imagenes] = await Promise.all([
    ctx.store.listDisciplinas(ctx.projectId),
    ctx.store.listElementos(ctx.projectId),
    ctx.store.listImagenes(ctx.projectId),
  ]);
  const disciplina = disciplinas.find((d) => d.id === disciplinaId);
  if (!disciplina) bad("Esa disciplina no es de este proyecto.");
  if (elementos.filter((e) => e.disciplinaId === disciplinaId && e.activo).length > MAX_ELEMENTOS_PLANTILLA) bad(`Una plantilla admite hasta ${MAX_ELEMENTOS_PLANTILLA} elementos.`);

  const id = nuevoId(ctx);
  const { contenido, copias } = contenidoPlantilla(disciplina, elementos, imagenes, (img) => `plantillas/${baseId}/${id}/${img.id}.${extension(img.tipo)}`);
  const fallidas = new Set<string>();
  for (const c of copias) await ctx.store.archivos.copiar(c.desde, c.hacia).catch(() => fallidas.add(c.hacia));
  if (fallidas.size) for (const e of contenido.elementos) e.imagenes = e.imagenes.filter((i) => !fallidas.has(i.ruta));
  const plantilla = await guardando(ctx.store.savePlantilla(baseId, { id, version: 0, nombre, descripcion, contenido, activo: true }, ctx.caller.name));
  return { plantilla, imagenesOmitidas: fallidas.size };
}

/** Renames a template or takes it out of use (templates are never deleted). */
export async function cambiarPlantilla(ctx: Ctx, body: unknown): Promise<{ plantilla: Plantilla }> {
  const baseId = await requireEditBase(ctx);
  const { id, version } = conId(body);
  const o = (body ?? {}) as { nombre?: unknown; descripcion?: unknown; activo?: unknown };
  const actual = (await ctx.store.listPlantillas(baseId)).find((p) => p.id === id);
  if (!actual) throw new ServiceError("La plantilla no existe en el catálogo.", 404);
  const nombre = typeof o.nombre === "string" ? o.nombre.trim().slice(0, 120) : actual.nombre;
  if (!nombre) bad("Falta el nombre de la plantilla.");
  const plantilla = await guardando(
    ctx.store.savePlantilla(
      baseId,
      {
        id,
        version,
        nombre,
        descripcion: typeof o.descripcion === "string" ? o.descripcion.trim().slice(0, 1000) : actual.descripcion,
        contenido: actual.contenido,
        activo: typeof o.activo === "boolean" ? o.activo : actual.activo,
      },
      ctx.caller.name
    )
  );
  return { plantilla };
}

/** Copies a template into this project as a new discipline (with -2, -3… if its code is taken). */
export async function aplicarPlantilla(
  ctx: Ctx,
  body: unknown
): Promise<{ disciplina: Disciplina; elementos: number; parametrosQuitados: number; imagenesOmitidas: number }> {
  const config = await requireEdit(ctx);
  const plantillaId = leerId((body as { plantillaId?: unknown } | null)?.plantillaId, "Plantilla");
  const [plantillas, disciplinas, parametros] = await Promise.all([
    ctx.store.listPlantillas(config.baseProjectId),
    ctx.store.listDisciplinas(ctx.projectId),
    ctx.store.listParametros(config.baseProjectId),
  ]);
  const plantilla = plantillas.find((p) => p.id === plantillaId && p.activo);
  if (!plantilla) throw new ServiceError("La plantilla no existe o está desactivada.", 404);
  const c = plantilla.contenido.disciplina;
  const disciplina = await guardando(
    ctx.store.saveDisciplina(
      ctx.projectId,
      {
        id: nuevoId(ctx),
        version: 0,
        codigo: codigoLibre(c.codigo, disciplinas.map((d) => d.codigo)),
        nombre: c.nombre,
        color: c.color,
        orden: Math.max(0, ...disciplinas.map((d) => d.orden)) + 1,
        activo: true,
      },
      ctx.caller.name
    )
  );
  const { elementos, parametrosQuitados } = elementosDePlantilla(plantilla.contenido, disciplina.id, new Set(parametros.map((p) => p.id)));
  let imagenesOmitidas = 0;
  for (const e of elementos) {
    const elemento = await guardando(ctx.store.saveElemento(ctx.projectId, { ...e.datos, id: nuevoId(ctx), version: 0 }, ctx.caller.name));
    for (const img of e.imagenes) {
      const id = nuevoId(ctx);
      const ruta = `${ctx.projectId}/${elemento.id}/${id}.${extension(img.tipo)}`;
      try {
        await ctx.store.archivos.copiar(img.ruta, ruta);
        await ctx.store.addImagen(ctx.projectId, { id, elementoId: elemento.id, ruta, nombre: img.nombre, tipo: img.tipo, ancho: img.ancho, alto: img.alto, bytes: img.bytes, subidaPor: ctx.caller.name });
      } catch {
        imagenesOmitidas++;
      }
    }
  }
  return { disciplina, elementos: elementos.length, parametrosQuitados, imagenesOmitidas };
}
