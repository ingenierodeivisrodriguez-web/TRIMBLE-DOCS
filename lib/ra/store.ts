import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { ConfigRA, ModeloGuardado } from "./types";

/**
 * Persistence of the AR extension. Two implementations with the same rules:
 * Supabase (tables of supabase/ra.sql through its REST API and the private
 * bucket "ra-modelos", always with the server-only key) and memory (for
 * `next dev` without a database and for tests).
 */

export const BUCKET = "ra-modelos";
const SETUP_HINT = "Falta crear las tablas de Realidad aumentada en Supabase: ejecuta supabase/ra.sql en el SQL Editor.";

/** The phone files (Supabase Storage, private bucket). */
export interface ArchivosRA {
  /** False when the server has no Supabase configured (only in memory). */
  disponible: boolean;
  /** A URL the browser can PUT this one object to, without any key. */
  firmarSubida(ruta: string): Promise<string>;
  /** Size of a stored object, or null when it is not there. */
  tamano(ruta: string): Promise<number | null>;
  /** A download URL valid for `segundos`. */
  firmar(ruta: string, segundos: number): Promise<string>;
  borrar(rutas: string[]): Promise<void>;
}

export interface RaStore {
  getConfig(projectId: string): Promise<ConfigRA | null>;
  saveConfig(projectId: string, diasSinUso: number, user: string): Promise<ConfigRA>;
  listar(projectId: string): Promise<ModeloGuardado[]>;
  obtener(projectId: string, id: string): Promise<ModeloGuardado | null>;
  crear(m: ModeloGuardado): Promise<ModeloGuardado>;
  actualizar(projectId: string, id: string, cambios: Partial<ModeloGuardado>): Promise<ModeloGuardado>;
  /** Models not yet deleted whose `eliminaEn` is before `antes` (any project). */
  vencidos(antes: string, limite: number): Promise<ModeloGuardado[]>;
  archivos: ArchivosRA;
}

// ------------------------------------------------------------------ Supabase

type Fila = Record<string, unknown>;

const aFila = (m: Partial<ModeloGuardado>): Fila => {
  const mapa: Record<string, string> = {
    id: "id",
    projectId: "project_id",
    nombre: "nombre",
    archivos: "archivos",
    filtros: "filtros",
    estado: "estado",
    ruta: "ruta",
    bytes: "bytes",
    triangulos: "triangulos",
    elementos: "elementos",
    origen: "origen",
    creado: "creado",
    creadoPor: "creado_por",
    creadoPorId: "creado_por_id",
    ultimoUso: "ultimo_uso",
    eliminaEn: "elimina_en",
    eliminado: "eliminado",
    eliminadoPor: "eliminado_por",
    motivoEliminacion: "motivo_eliminacion",
  };
  const fila: Fila = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined && mapa[k]) fila[mapa[k]] = v;
  return fila;
};

const deFila = (f: Fila): ModeloGuardado => ({
  id: String(f.id),
  projectId: String(f.project_id),
  nombre: String(f.nombre),
  archivos: (f.archivos as ModeloGuardado["archivos"]) ?? [],
  filtros: { nivelesExcluidos: [], clasesExcluidas: [], ...((f.filtros as object) ?? {}) },
  estado: f.estado as ModeloGuardado["estado"],
  ruta: String(f.ruta),
  bytes: Number(f.bytes),
  triangulos: Number(f.triangulos),
  elementos: Number(f.elementos),
  origen: (f.origen as ModeloGuardado["origen"]) ?? [0, 0, 0],
  creado: String(f.creado),
  creadoPor: (f.creado_por as string | null) ?? null,
  creadoPorId: (f.creado_por_id as string | null) ?? null,
  ultimoUso: (f.ultimo_uso as string | null) ?? null,
  eliminaEn: (f.elimina_en as string | null) ?? null,
  eliminado: (f.eliminado as string | null) ?? null,
  eliminadoPor: (f.eliminado_por as string | null) ?? null,
  motivoEliminacion: (f.motivo_eliminacion as ModeloGuardado["motivoEliminacion"]) ?? null,
});

function claveServidor(): { url: string; headers: Record<string, string> } | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;
  const headers: Record<string, string> = { apikey: key };
  // Legacy service_role keys are JWTs; the newer "sb_secret_…" keys only go as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { url: rawUrl.replace(/\/+$/, ""), headers };
}

const ruta = (r: string) => r.split("/").map(encodeURIComponent).join("/");

function almacenSupabase(): ArchivosRA | null {
  const clave = claveServidor();
  if (!clave) return null;
  const base = `${clave.url}/storage/v1`;
  async function call(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...clave!.headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    if (/bucket not found/i.test(body)) throw new StoreError(`Falta el bucket "${BUCKET}" en Supabase Storage: ejecuta de nuevo supabase/ra.sql en el SQL Editor.`);
    throw new StoreError(`Supabase Storage respondió ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return {
    disponible: true,
    async firmarSubida(r) {
      const res = (await (await call(`/object/upload/sign/${BUCKET}/${ruta(r)}`, json({}))).json()) as { url?: string };
      if (!res.url) throw new StoreError("Supabase Storage no entregó el enlace de subida.");
      return `${base}${res.url}`;
    },
    async tamano(r) {
      const corte = r.lastIndexOf("/");
      const carpeta = r.slice(0, corte);
      const nombre = r.slice(corte + 1);
      const lista = (await (await call(`/object/list/${BUCKET}`, json({ prefix: carpeta, search: nombre, limit: 10 }))).json()) as {
        name: string;
        metadata?: { size?: number } | null;
      }[];
      const hit = lista.find((o) => o.name === nombre);
      return hit ? Number(hit.metadata?.size ?? 0) : null;
    },
    async firmar(r, segundos) {
      const res = (await (await call(`/object/sign/${BUCKET}/${ruta(r)}`, json({ expiresIn: segundos }))).json()) as { signedURL?: string };
      if (!res.signedURL) throw new StoreError("Supabase Storage no entregó el enlace del archivo.");
      return `${base}${res.signedURL}`;
    },
    async borrar(rutas) {
      if (rutas.length) await call(`/object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: rutas }), headers: { "Content-Type": "application/json" } });
    },
  };
}

function supabaseStore(): RaStore | null {
  const db = clienteSupabase((_status, body) => (faltaTabla(body) || /PGRST204|42703/.test(body) ? new StoreError(SETUP_HINT) : null));
  const archivos = almacenSupabase();
  if (!db || !archivos) return null;
  const { call, json, all } = db;
  const una = (filas: Fila[]) => {
    if (!filas[0]) throw new StoreError("No se encontró el modelo.", 404);
    return deFila(filas[0]);
  };
  return {
    archivos,
    async getConfig(projectId) {
      const filas = await json<Fila[]>(`/ra_config?project_id=${eq(projectId)}&select=*`);
      const f = filas[0];
      return f ? { diasSinUso: Number(f.dias_sin_uso), actualizado: (f.actualizado as string) ?? null, actualizadoPor: (f.actualizado_por as string) ?? null } : null;
    },
    async saveConfig(projectId, diasSinUso, user) {
      const ahora = new Date().toISOString();
      await call(`/ra_config?on_conflict=project_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ project_id: projectId, dias_sin_uso: diasSinUso, actualizado: ahora, actualizado_por: user }),
      });
      return { diasSinUso, actualizado: ahora, actualizadoPor: user };
    },
    async listar(projectId) {
      return (await all<Fila>(`/ra_modelos?project_id=${eq(projectId)}&select=*&order=creado.desc`)).map(deFila);
    },
    async obtener(projectId, id) {
      const filas = await json<Fila[]>(`/ra_modelos?project_id=${eq(projectId)}&id=${eq(id)}&select=*`);
      return filas[0] ? deFila(filas[0]) : null;
    },
    async crear(m) {
      return una(await json<Fila[]>(`/ra_modelos`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(aFila(m)) }));
    },
    async actualizar(projectId, id, cambios) {
      const { id: _i, projectId: _p, ...resto } = cambios;
      return una(
        await json<Fila[]>(`/ra_modelos?project_id=${eq(projectId)}&id=${eq(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(aFila(resto)) })
      );
    },
    async vencidos(antes, limite) {
      return (await json<Fila[]>(`/ra_modelos?estado=neq.eliminado&elimina_en=lt.${encodeURIComponent(antes)}&select=*&order=elimina_en.asc&limit=${limite}`)).map(deFila);
    },
  };
}

// -------------------------------------------------------------------- memory

export function archivosEnMemoria(): ArchivosRA & { contenido: Map<string, Uint8Array> } {
  const contenido = new Map<string, Uint8Array>();
  return {
    disponible: true,
    contenido,
    async firmarSubida(r) {
      return `memoria://${r}`;
    },
    async tamano(r) {
      return contenido.get(r)?.length ?? null;
    },
    async firmar(r) {
      return `memoria://${r}`;
    },
    async borrar(rutas) {
      for (const r of rutas) contenido.delete(r);
    },
  };
}

export function memoryStore(archivos: ArchivosRA = archivosEnMemoria()): RaStore {
  const configs = new Map<string, ConfigRA>();
  const modelos = new Map<string, ModeloGuardado>();
  const copia = (m: ModeloGuardado) => structuredClone(m);
  return {
    archivos,
    async getConfig(projectId) {
      const c = configs.get(projectId);
      return c ? { ...c } : null;
    },
    async saveConfig(projectId, diasSinUso, user) {
      const c = { diasSinUso, actualizado: new Date().toISOString(), actualizadoPor: user };
      configs.set(projectId, c);
      return { ...c };
    },
    async listar(projectId) {
      return [...modelos.values()].filter((m) => m.projectId === projectId).sort((a, b) => b.creado.localeCompare(a.creado)).map(copia);
    },
    async obtener(projectId, id) {
      const m = modelos.get(id);
      return m && m.projectId === projectId ? copia(m) : null;
    },
    async crear(m) {
      modelos.set(m.id, copia(m));
      return copia(m);
    },
    async actualizar(projectId, id, cambios) {
      const m = modelos.get(id);
      if (!m || m.projectId !== projectId) throw new StoreError("No se encontró el modelo.", 404);
      const { id: _i, projectId: _p, ...resto } = cambios;
      const nuevo = { ...m, ...resto };
      modelos.set(id, nuevo);
      return copia(nuevo);
    },
    async vencidos(antes, limite) {
      return [...modelos.values()]
        .filter((m) => m.estado !== "eliminado" && m.eliminaEn !== null && m.eliminaEn < antes)
        .sort((a, b) => (a.eliminaEn ?? "").localeCompare(b.eliminaEn ?? ""))
        .slice(0, limite)
        .map(copia);
    },
  };
}

let selected: RaStore | null | undefined;
let devStore: RaStore | undefined;

export function raStore(): RaStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError("La base de datos de Realidad aumentada no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/ra.sql y vuelve a desplegar.");
  }
  return (devStore ??= memoryStore());
}
