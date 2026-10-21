import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import type { Responsable } from "../propiedades/types";
import { StoreError } from "../propiedades/store";
import type {
  Disciplina,
  DisciplinaData,
  Elemento,
  ElementoData,
  GrupoTdi,
  Parametro,
  ParametroData,
  Plantilla,
  PlantillaData,
} from "./types";

/**
 * Persistence of "Requisitos BIM (LOIN)". Two implementations with the same
 * rules: Supabase (tables and functions of supabase/loin.sql through its REST
 * API, images in its private Storage bucket, always with the server-only key)
 * and memory (for `next dev` without a database and for tests). Refusals come
 * as a StoreError whose message is the reason: "version-conflict",
 * "duplicate-code" or "disciplina-ajena".
 */
export interface StoredConfig {
  baseProjectId: string;
  baseProjectName: string;
  editores: Responsable[];
  /** null: the initial ones. */
  valoresBasura: string[] | null;
  umbralAmarillo: number | null;
}

export interface ImagenGuardada {
  id: string;
  elementoId: string;
  /** Where the file is in the bucket. */
  ruta: string;
  nombre: string;
  tipo: string;
  ancho: number;
  alto: number;
  bytes: number;
  subida: string;
  subidaPor: string | null;
}

export type ConVersion<T> = T & { id: string; version: number };

/** The image files (Supabase Storage, private bucket). */
export interface Archivos {
  /** False when the server has no Supabase configured (only in memory). */
  disponible: boolean;
  subir(ruta: string, contenido: Uint8Array, tipo: string): Promise<void>;
  /** Signed URLs valid for `segundos`, by path (missing when one couldn't be signed). */
  firmar(rutas: string[], segundos: number): Promise<Map<string, string>>;
  borrar(rutas: string[]): Promise<void>;
  copiar(desde: string, hacia: string): Promise<void>;
}

export interface LoinStore {
  getConfig(projectId: string): Promise<StoredConfig | null>;
  saveConfig(projectId: string, config: StoredConfig, user: string): Promise<void>;
  getGruposTdi(baseId: string): Promise<GrupoTdi[] | null>;
  saveGruposTdi(baseId: string, grupos: GrupoTdi[], user: string): Promise<void>;

  listParametros(baseId: string): Promise<Parametro[]>;
  /** All or none: version 0 creates, otherwise only if the row is still at that version. */
  saveParametros(baseId: string, filas: ConVersion<ParametroData>[], user: string): Promise<Parametro[]>;

  listDisciplinas(projectId: string): Promise<Disciplina[]>;
  saveDisciplina(projectId: string, fila: ConVersion<DisciplinaData>, user: string): Promise<Disciplina>;
  listElementos(projectId: string): Promise<Elemento[]>;
  saveElemento(projectId: string, fila: ConVersion<ElementoData>, user: string): Promise<Elemento>;

  listImagenes(projectId: string): Promise<ImagenGuardada[]>;
  addImagen(projectId: string, imagen: Omit<ImagenGuardada, "subida">): Promise<ImagenGuardada>;
  /** Removes the row and answers what it was (null if it isn't the project's). */
  deleteImagen(projectId: string, id: string): Promise<ImagenGuardada | null>;

  listPlantillas(baseId: string): Promise<Plantilla[]>;
  /** Once saved, only the name, description and active flag of a template change. */
  savePlantilla(baseId: string, fila: ConVersion<PlantillaData>, user: string): Promise<Plantilla>;

  archivos: Archivos;
}

export const BUCKET = "loin-imagenes";

const SETUP_HINT =
  "Faltan las tablas de Requisitos BIM (LOIN) en Supabase: abre Supabase → SQL Editor y ejecuta el archivo supabase/loin.sql del repositorio (se puede repetir sin perder datos).";

const MOTIVOS = ["version-conflict", "duplicate-code", "disciplina-ajena"] as const;

// ---------------------------------------------------------------- rows

interface ParametroRow {
  id: string;
  codigo: string;
  numero: number | null;
  nombre: string;
  descripcion: string;
  tdi: string;
  ndi: number;
  origen: Parametro["origen"];
  tipo_dato: Parametro["tipoDato"];
  unidad: string;
  valores_permitidos: string[];
  regla: Partial<Parametro["regla"]>;
  alias: Parametro["alias"];
  ids_uri: string;
  activo: boolean;
  version: number;
  actualizado: string;
  actualizado_por: string | null;
}

const reglaDe = (r: Partial<Parametro["regla"]> | null | undefined): Parametro["regla"] => ({
  min: typeof r?.min === "number" ? r.min : null,
  max: typeof r?.max === "number" ? r.max : null,
  patron: typeof r?.patron === "string" ? r.patron : "",
});

const parametroDeFila = (r: ParametroRow): Parametro => ({
  id: r.id,
  codigo: r.codigo,
  numero: r.numero,
  nombre: r.nombre,
  descripcion: r.descripcion,
  tdi: r.tdi,
  ndi: r.ndi as Parametro["ndi"],
  origen: r.origen,
  tipoDato: r.tipo_dato,
  unidad: r.unidad,
  valoresPermitidos: r.valores_permitidos ?? [],
  regla: reglaDe(r.regla),
  alias: r.alias ?? [],
  idsUri: r.ids_uri,
  activo: r.activo,
  version: r.version,
  actualizado: r.actualizado,
  actualizadoPor: r.actualizado_por,
});

const filaDeParametro = (p: ConVersion<ParametroData>) => ({
  id: p.id,
  version: p.version,
  codigo: p.codigo,
  numero: p.numero,
  nombre: p.nombre,
  descripcion: p.descripcion,
  tdi: p.tdi,
  ndi: p.ndi,
  origen: p.origen,
  tipo_dato: p.tipoDato,
  unidad: p.unidad,
  valores_permitidos: p.valoresPermitidos,
  regla: p.regla,
  alias: p.alias,
  ids_uri: p.idsUri,
  activo: p.activo,
});

interface DisciplinaRow {
  id: string;
  codigo: string;
  nombre: string;
  color: string;
  orden: number;
  activo: boolean;
  version: number;
  actualizado: string;
  actualizado_por: string | null;
}

const disciplinaDeFila = (r: DisciplinaRow): Disciplina => ({
  id: r.id,
  codigo: r.codigo,
  nombre: r.nombre,
  color: r.color,
  orden: r.orden,
  activo: r.activo,
  version: r.version,
  actualizado: r.actualizado,
  actualizadoPor: r.actualizado_por,
});

interface ElementoRow {
  id: string;
  disciplina_id: string;
  codigo: string;
  nombre: string;
  clase_ifc: string;
  tipo_predefinido: string;
  clasificacion_sistema: string;
  clasificacion_codigo: string;
  notas: string;
  parametros: Elemento["parametros"];
  orden: number;
  activo: boolean;
  version: number;
  actualizado: string;
  actualizado_por: string | null;
}

const elementoDeFila = (r: ElementoRow): Elemento => ({
  id: r.id,
  disciplinaId: r.disciplina_id,
  codigo: r.codigo,
  nombre: r.nombre,
  claseIfc: r.clase_ifc,
  tipoPredefinido: r.tipo_predefinido,
  clasificacionSistema: r.clasificacion_sistema,
  clasificacionCodigo: r.clasificacion_codigo,
  notas: r.notas,
  parametros: (r.parametros ?? []).map((p) => ({ parametroId: p.parametroId, obligatorio: p.obligatorio !== false, ndi: p.ndi ?? null, regla: p.regla ? reglaDe(p.regla) : null })),
  orden: r.orden,
  activo: r.activo,
  version: r.version,
  actualizado: r.actualizado,
  actualizadoPor: r.actualizado_por,
});

const filaDeElemento = (e: ConVersion<ElementoData>) => ({
  id: e.id,
  version: e.version,
  disciplina_id: e.disciplinaId,
  codigo: e.codigo,
  nombre: e.nombre,
  clase_ifc: e.claseIfc,
  tipo_predefinido: e.tipoPredefinido,
  clasificacion_sistema: e.clasificacionSistema,
  clasificacion_codigo: e.clasificacionCodigo,
  notas: e.notas,
  parametros: e.parametros,
  orden: e.orden,
  activo: e.activo,
});

interface ImagenRow {
  id: string;
  elemento_id: string;
  ruta: string;
  nombre: string;
  tipo: string;
  ancho: number;
  alto: number;
  bytes: number;
  subida: string;
  subida_por: string | null;
}

const imagenDeFila = (r: ImagenRow): ImagenGuardada => ({
  id: r.id,
  elementoId: r.elemento_id,
  ruta: r.ruta,
  nombre: r.nombre,
  tipo: r.tipo,
  ancho: r.ancho,
  alto: r.alto,
  bytes: r.bytes,
  subida: r.subida,
  subidaPor: r.subida_por,
});

interface PlantillaRow {
  id: string;
  nombre: string;
  descripcion: string;
  contenido: Plantilla["contenido"];
  activo: boolean;
  version: number;
  creada: string;
  creada_por: string | null;
  actualizado: string;
}

const plantillaDeFila = (r: PlantillaRow): Plantilla => ({
  id: r.id,
  nombre: r.nombre,
  descripcion: r.descripcion,
  contenido: r.contenido,
  activo: r.activo,
  version: r.version,
  creada: r.creada,
  creadaPor: r.creada_por,
  actualizado: r.actualizado,
});

// ---------------------------------------------------------------- Supabase

function claveServidor(): { url: string; headers: Record<string, string> } | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;
  const headers: Record<string, string> = { apikey: key };
  // Legacy service_role keys are JWTs; the newer "sb_secret_…" keys only go as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { url: rawUrl.replace(/\/+$/, ""), headers };
}

const TIMEOUT_MS = 20_000;
const ruta = (r: string) => r.split("/").map(encodeURIComponent).join("/");

/** The private bucket through the Storage API (the browser never gets the key, only signed URLs). */
function almacenSupabase(): Archivos | null {
  const clave = claveServidor();
  if (!clave) return null;
  const base = `${clave.url}/storage/v1`;
  async function call(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...clave!.headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    if (/bucket not found/i.test(body)) {
      throw new StoreError(`Falta el bucket "${BUCKET}" en Supabase Storage: ejecuta de nuevo supabase/loin.sql en el SQL Editor.`);
    }
    throw new StoreError(`Supabase Storage respondió ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return {
    disponible: true,
    async subir(r, contenido, tipo) {
      await call(`/object/${BUCKET}/${ruta(r)}`, { method: "POST", body: contenido as unknown as BodyInit, headers: { "Content-Type": tipo, "x-upsert": "false" } });
    },
    async firmar(rutas, segundos) {
      const out = new Map<string, string>();
      for (let i = 0; i < rutas.length; i += 500) {
        const lote = rutas.slice(i, i + 500);
        const res = await call(`/object/sign/${BUCKET}`, json({ expiresIn: segundos, paths: lote }));
        const firmadas = (await res.json()) as { path?: string; signedURL?: string | null; error?: string | null }[];
        firmadas.forEach((f, j) => {
          if (f.signedURL) out.set(f.path ?? lote[j], `${base}${f.signedURL}`);
        });
      }
      return out;
    },
    async borrar(rutas) {
      if (rutas.length) await call(`/object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: rutas }), headers: { "Content-Type": "application/json" } });
    },
    async copiar(desde, hacia) {
      await call("/object/copy", json({ bucketId: BUCKET, sourceKey: desde, destinationKey: hacia }));
    },
  };
}

function supabaseStore(): LoinStore | null {
  const db = clienteSupabase((_status, body, detail) => {
    const texto = detail.message ?? body;
    const motivo = MOTIVOS.find((m) => texto.includes(m));
    if (motivo) return new StoreError(motivo, motivo === "disciplina-ajena" ? 400 : 409);
    if (faltaTabla(body)) return new StoreError(SETUP_HINT);
    return null;
  });
  const archivos = almacenSupabase();
  if (!db || !archivos) return null;
  const { call, json, all } = db;
  const rpc = <T>(fn: string, body: unknown) => json<T>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });
  const upsert = (tabla: string, fila: Record<string, unknown>, conflicto: string) =>
    call(`/${tabla}?on_conflict=${conflicto}`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(fila) });

  return {
    async getConfig(projectId) {
      const rows = await json<{ base_project_id: string; base_project_name: string; editores: Responsable[]; valores_basura: string[] | null; umbral_amarillo: number | string | null }[]>(
        `/loin_config?project_id=${eq(projectId)}&select=base_project_id,base_project_name,editores,valores_basura,umbral_amarillo`
      );
      const r = rows[0];
      if (!r) return null;
      return {
        baseProjectId: r.base_project_id,
        baseProjectName: r.base_project_name,
        editores: r.editores ?? [],
        valoresBasura: r.valores_basura,
        umbralAmarillo: r.umbral_amarillo === null ? null : Number(r.umbral_amarillo),
      };
    },
    async saveConfig(projectId, c, user) {
      await upsert(
        "loin_config",
        {
          project_id: projectId,
          base_project_id: c.baseProjectId,
          base_project_name: c.baseProjectName,
          editores: c.editores,
          valores_basura: c.valoresBasura,
          umbral_amarillo: c.umbralAmarillo,
          updated_at: new Date().toISOString(),
          updated_by: user,
        },
        "project_id"
      );
    },
    async getGruposTdi(baseId) {
      const rows = await json<{ tdi_grupos: GrupoTdi[] }[]>(`/loin_catalogos?base_id=${eq(baseId)}&select=tdi_grupos`);
      return rows[0]?.tdi_grupos ?? null;
    },
    async saveGruposTdi(baseId, grupos, user) {
      await upsert("loin_catalogos", { base_id: baseId, tdi_grupos: grupos, updated_at: new Date().toISOString(), updated_by: user }, "base_id");
    },

    async listParametros(baseId) {
      return (await all<ParametroRow>(`/loin_parametros?base_id=${eq(baseId)}&select=*&order=tdi.asc,numero.asc.nullslast,codigo.asc`)).map(parametroDeFila);
    },
    async saveParametros(baseId, filas, user) {
      return (await rpc<ParametroRow[]>("loin_guardar_parametros", { p_base_id: baseId, p_filas: filas.map(filaDeParametro), p_usuario: user })).map(parametroDeFila);
    },

    async listDisciplinas(projectId) {
      return (await all<DisciplinaRow>(`/loin_disciplinas?project_id=${eq(projectId)}&select=*&order=orden.asc,codigo.asc`)).map(disciplinaDeFila);
    },
    async saveDisciplina(projectId, d, user) {
      const fila = { id: d.id, version: d.version, codigo: d.codigo, nombre: d.nombre, color: d.color, orden: d.orden, activo: d.activo };
      return disciplinaDeFila(await rpc<DisciplinaRow>("loin_guardar_disciplina", { p_project_id: projectId, p_fila: fila, p_usuario: user }));
    },
    async listElementos(projectId) {
      return (await all<ElementoRow>(`/loin_elementos?project_id=${eq(projectId)}&select=*&order=orden.asc,codigo.asc`)).map(elementoDeFila);
    },
    async saveElemento(projectId, e, user) {
      return elementoDeFila(await rpc<ElementoRow>("loin_guardar_elemento", { p_project_id: projectId, p_fila: filaDeElemento(e), p_usuario: user }));
    },

    async listImagenes(projectId) {
      return (await all<ImagenRow>(`/loin_imagenes?project_id=${eq(projectId)}&select=*&order=subida.asc`)).map(imagenDeFila);
    },
    async addImagen(projectId, i) {
      const rows = await json<ImagenRow[]>("/loin_imagenes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          id: i.id, project_id: projectId, elemento_id: i.elementoId, ruta: i.ruta, nombre: i.nombre, tipo: i.tipo, ancho: i.ancho, alto: i.alto, bytes: i.bytes, subida_por: i.subidaPor,
        }),
      });
      return imagenDeFila(rows[0]);
    },
    async deleteImagen(projectId, id) {
      const rows = await json<ImagenRow[]>(`/loin_imagenes?project_id=${eq(projectId)}&id=${eq(id)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      return rows[0] ? imagenDeFila(rows[0]) : null;
    },

    async listPlantillas(baseId) {
      return (await all<PlantillaRow>(`/loin_plantillas?base_id=${eq(baseId)}&select=*&order=nombre.asc`)).map(plantillaDeFila);
    },
    async savePlantilla(baseId, p, user) {
      const fila = { id: p.id, version: p.version, nombre: p.nombre, descripcion: p.descripcion, contenido: p.contenido, activo: p.activo };
      return plantillaDeFila(await rpc<PlantillaRow>("loin_guardar_plantilla", { p_base_id: baseId, p_fila: fila, p_usuario: user }));
    },

    archivos,
  };
}

// ---------------------------------------------------------------- memory

function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  // In the browser (local preview), in slices so a big image doesn't overflow the call stack.
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

/** Images kept in memory; "signed" URLs are data: URLs. */
export function archivosEnMemoria(): Archivos & { contenido: Map<string, { bytes: Uint8Array; tipo: string }> } {
  const contenido = new Map<string, { bytes: Uint8Array; tipo: string }>();
  return {
    disponible: true,
    contenido,
    async subir(r, bytes, tipo) {
      if (contenido.has(r)) throw new StoreError("Ya existe un archivo en esa ruta.", 409);
      contenido.set(r, { bytes: new Uint8Array(bytes), tipo });
    },
    async firmar(rutas) {
      const out = new Map<string, string>();
      for (const r of rutas) {
        const a = contenido.get(r);
        if (a) out.set(r, `data:${a.tipo};base64,${base64(a.bytes)}`);
      }
      return out;
    },
    async borrar(rutas) {
      for (const r of rutas) contenido.delete(r);
    },
    async copiar(desde, hacia) {
      const a = contenido.get(desde);
      if (!a) throw new StoreError("El archivo de origen no existe.", 404);
      contenido.set(hacia, { ...a });
    },
  };
}

const codigoClave = (c: string) => c.trim().toLowerCase();

export function memoryStore(archivos: Archivos = archivosEnMemoria()): LoinStore {
  const configs = new Map<string, StoredConfig>();
  const tdi = new Map<string, GrupoTdi[]>();
  const parametros = new Map<string, Parametro & { baseId: string }>();
  const disciplinas = new Map<string, Disciplina & { projectId: string }>();
  const elementos = new Map<string, Elemento & { projectId: string }>();
  const imagenes = new Map<string, ImagenGuardada & { projectId: string }>();
  const plantillas = new Map<string, Plantilla & { baseId: string }>();
  const ahora = () => new Date().toISOString();
  const rechazo = (motivo: (typeof MOTIVOS)[number]) => new StoreError(motivo, motivo === "disciplina-ajena" ? 400 : 409);
  const sin = <T extends object, K extends string>(x: T, k: K): Omit<T, K> => {
    const copia = structuredClone(x) as Record<string, unknown>;
    delete copia[k];
    return copia as Omit<T, K>;
  };

  /** Version 0 creates (the id must be new), otherwise the row must still be at `version` and belong to `dueno`. */
  function revisarVersion<T extends { version: number }>(mapa: Map<string, T>, id: string, version: number, esDelDueno: (x: T) => boolean): T | null {
    const actual = mapa.get(id);
    if (version === 0) {
      if (actual) throw rechazo("version-conflict");
      return null;
    }
    if (!actual || !esDelDueno(actual) || actual.version !== version) throw rechazo("version-conflict");
    return actual;
  }

  return {
    async getConfig(projectId) {
      const c = configs.get(projectId);
      return c ? structuredClone(c) : null;
    },
    async saveConfig(projectId, c) {
      configs.set(projectId, structuredClone(c));
    },
    async getGruposTdi(baseId) {
      const g = tdi.get(baseId);
      return g ? structuredClone(g) : null;
    },
    async saveGruposTdi(baseId, grupos) {
      tdi.set(baseId, structuredClone(grupos));
    },

    async listParametros(baseId) {
      return [...parametros.values()]
        .filter((p) => p.baseId === baseId)
        .sort((a, b) => a.tdi.localeCompare(b.tdi) || (a.numero ?? Infinity) - (b.numero ?? Infinity) || a.codigo.localeCompare(b.codigo))
        .map((p) => sin(p, "baseId"));
    },
    async saveParametros(baseId, filas, user) {
      // Checked first and applied after: all or none, like the SQL function.
      const siguiente = new Map([...parametros].filter(([, p]) => p.baseId === baseId));
      const guardados: Parametro[] = [];
      for (const f of filas) {
        const actual = revisarVersion(parametros, f.id, f.version, (p) => p.baseId === baseId);
        if (!actual && siguiente.has(f.id)) throw rechazo("version-conflict");
        const { version: _, ...datos } = f;
        const p = { ...structuredClone(datos), baseId, version: (actual?.version ?? 0) + 1, actualizado: ahora(), actualizadoPor: user };
        siguiente.set(f.id, p);
        guardados.push(sin(p, "baseId"));
      }
      const codigos = new Set<string>();
      for (const p of siguiente.values()) {
        if (codigos.has(codigoClave(p.codigo))) throw rechazo("duplicate-code");
        codigos.add(codigoClave(p.codigo));
      }
      for (const [id, p] of siguiente) parametros.set(id, p);
      return guardados;
    },

    async listDisciplinas(projectId) {
      return [...disciplinas.values()].filter((d) => d.projectId === projectId).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)).map((d) => sin(d, "projectId"));
    },
    async saveDisciplina(projectId, f, user) {
      const actual = revisarVersion(disciplinas, f.id, f.version, (d) => d.projectId === projectId);
      if ([...disciplinas.values()].some((d) => d.projectId === projectId && d.id !== f.id && codigoClave(d.codigo) === codigoClave(f.codigo))) throw rechazo("duplicate-code");
      const { version: _, ...datos } = f;
      const d = { ...structuredClone(datos), projectId, version: (actual?.version ?? 0) + 1, actualizado: ahora(), actualizadoPor: user };
      disciplinas.set(f.id, d);
      return sin(d, "projectId");
    },
    async listElementos(projectId) {
      return [...elementos.values()].filter((e) => e.projectId === projectId).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)).map((e) => sin(e, "projectId"));
    },
    async saveElemento(projectId, f, user) {
      if (disciplinas.get(f.disciplinaId)?.projectId !== projectId) throw rechazo("disciplina-ajena");
      const actual = revisarVersion(elementos, f.id, f.version, (e) => e.projectId === projectId);
      if ([...elementos.values()].some((e) => e.disciplinaId === f.disciplinaId && e.id !== f.id && codigoClave(e.codigo) === codigoClave(f.codigo))) throw rechazo("duplicate-code");
      const { version: _, ...datos } = f;
      const e = { ...structuredClone(datos), projectId, version: (actual?.version ?? 0) + 1, actualizado: ahora(), actualizadoPor: user };
      elementos.set(f.id, e);
      return sin(e, "projectId");
    },

    async listImagenes(projectId) {
      return [...imagenes.values()].filter((i) => i.projectId === projectId).map((i) => sin(i, "projectId"));
    },
    async addImagen(projectId, i) {
      if (elementos.get(i.elementoId)?.projectId !== projectId) throw rechazo("disciplina-ajena");
      const guardada = { ...structuredClone(i), subida: ahora(), projectId };
      imagenes.set(i.id, guardada);
      return sin(guardada, "projectId");
    },
    async deleteImagen(projectId, id) {
      const i = imagenes.get(id);
      if (!i || i.projectId !== projectId) return null;
      imagenes.delete(id);
      return sin(i, "projectId");
    },

    async listPlantillas(baseId) {
      return [...plantillas.values()].filter((p) => p.baseId === baseId).sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => sin(p, "baseId"));
    },
    async savePlantilla(baseId, f, user) {
      const actual = revisarVersion(plantillas, f.id, f.version, (p) => p.baseId === baseId);
      const { version: _, ...datos } = f;
      const p = actual
        ? { ...actual, nombre: f.nombre, descripcion: f.descripcion, activo: f.activo, version: actual.version + 1, actualizado: ahora() }
        : { ...structuredClone(datos), baseId, version: 1, creada: ahora(), creadaPor: user, actualizado: ahora() };
      plantillas.set(f.id, p);
      return sin(p, "baseId");
    },

    archivos,
  };
}

let selected: LoinStore | null | undefined;
let devStore: LoinStore | undefined;

/** Supabase when configured; in development without it, data kept in memory. */
export function loinStore(): LoinStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError(
      "La base de datos de Requisitos BIM (LOIN) no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/loin.sql y vuelve a desplegar."
    );
  }
  return (devStore ??= memoryStore());
}
