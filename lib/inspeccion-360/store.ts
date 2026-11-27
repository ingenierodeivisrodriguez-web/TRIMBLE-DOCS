import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import { CARPETA_INICIAL, type Captura, type ConfigI360, type Foto, type Punto } from "./types";

/**
 * Persistence of Inspección 360°. Two implementations with the same rules: Supabase (tables of
 * supabase/inspeccion-360.sql through its REST API and the private bucket "i360-fotos", always
 * with the server-only key) and memory (tests and `next dev` without a database).
 */

export const BUCKET = "i360-fotos";
const SETUP_HINT = "Faltan tablas o campos de Inspección 360° en Supabase: ejecuta (otra vez) supabase/inspeccion-360.sql en el SQL Editor.";

/** The temporary copy of a photo while it goes to the CDE (Supabase Storage, private bucket). */
export interface ArchivosI360 {
  disponible: boolean;
  /** A URL the browser can PUT this one object to, without any key. */
  firmarSubida(ruta: string): Promise<string>;
  /** The object's bytes, or null when it is not there. */
  leer(ruta: string): Promise<Uint8Array | null>;
  borrar(rutas: string[]): Promise<void>;
}

/** A save that lost against someone else's: the version it carried is no longer the current one. */
export class ConflictoVersion extends Error {}
/** A unique value already taken (the point's code). */
export class Repetido extends Error {}

export interface I360Store {
  archivos: ArchivosI360;
  getConfig(projectId: string): Promise<ConfigI360 | null>;
  saveConfig(projectId: string, c: { codigoProyecto: string | null; carpetaNombre: string; editores: string[] }, version: number, quien: string): Promise<ConfigI360>;
  listarPuntos(projectId: string): Promise<Punto[]>;
  obtenerPunto(projectId: string, id: string): Promise<Punto | null>;
  crearPunto(p: Punto): Promise<Punto>;
  /** Saves only if the point still has `version`; the stored one gets version + 1. */
  actualizarPunto(projectId: string, id: string, version: number, cambios: Partial<Punto>): Promise<Punto>;
  listarCapturas(projectId: string, puntoId?: string): Promise<Captura[]>;
  obtenerCaptura(projectId: string, id: string): Promise<Captura | null>;
  crearCaptura(c: Captura): Promise<Captura>;
  actualizarCaptura(projectId: string, id: string, cambios: Partial<Captura>): Promise<Captura>;
  /** Saves the turn only if the stored one is still `anterior` (else ConflictoVersion: another person changed it). */
  alinearCaptura(projectId: string, id: string, anterior: number, giro: number, quien: string): Promise<Captura>;
  fotosDe(projectId: string, capturaIds: string[]): Promise<Foto[]>;
  obtenerFoto(projectId: string, id: string): Promise<Foto | null>;
  crearFoto(f: Foto): Promise<Foto>;
  actualizarFoto(projectId: string, id: string, cambios: Partial<Foto>): Promise<Foto>;
  /** File names already used in the project that start with `prefijo`. */
  nombresUsados(projectId: string, prefijo: string): Promise<string[]>;
}

// -------------------------------------------------------------------- rows

type Fila = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const nul = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v);
const numNul = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const CAMPOS_PUNTO: Record<keyof Punto, string> = {
  id: "id", projectId: "project_id", codigo: "codigo", torre: "torre", piso: "piso", unidad: "unidad", numero: "numero",
  espacio: "espacio", zona: "zona", referenciaFisica: "referencia_fisica", modelId: "model_id", versionId: "version_id",
  x: "x", y: "y", z: "z", alturaM: "altura_m", rumboGrados: "rumbo_grados", estado: "estado", motivo: "motivo",
  version: "version", creado: "creado", creadoPor: "creado_por", creadoPorNombre: "creado_por_nombre",
  actualizado: "actualizado", actualizadoPor: "actualizado_por",
};
// The turn is written only by alinearCaptura (so creating a capture works before block 2 of the SQL is run).
const CAMPOS_CAPTURA: Record<Exclude<keyof Captura, "giroGrados" | "giroPor" | "giroEn">, string> = {
  id: "id", projectId: "project_id", puntoId: "punto_id", tomadaEn: "tomada_en", observaciones: "observaciones",
  estado: "estado", motivo: "motivo", inspectorId: "inspector_id", inspectorNombre: "inspector_nombre",
  creado: "creado", actualizado: "actualizado", actualizadoPor: "actualizado_por",
};
const CAMPOS_FOTO: Record<keyof Foto, string> = {
  id: "id", projectId: "project_id", capturaId: "captura_id", tipo: "tipo", nombreArchivo: "nombre_archivo",
  nombreOriginal: "nombre_original", tamano: "tamano", ancho: "ancho", alto: "alto", miniatura: "miniatura",
  rutaTemporal: "ruta_temporal", cdeCarpetaId: "cde_carpeta_id", cdeFileId: "cde_file_id", cdeVersionId: "cde_version_id",
  estado: "estado", error: "error", creado: "creado", actualizado: "actualizado",
};
function aFila<T extends object>(campos: Record<string, string>, o: Partial<T>): Fila {
  const f: Fila = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && campos[k]) f[campos[k]] = v;
  return f;
}

const dePunto = (f: Fila): Punto => ({
  id: txt(f.id), projectId: txt(f.project_id), codigo: txt(f.codigo), torre: txt(f.torre), piso: txt(f.piso), unidad: txt(f.unidad),
  numero: num(f.numero), espacio: txt(f.espacio), zona: txt(f.zona), referenciaFisica: txt(f.referencia_fisica),
  modelId: txt(f.model_id), versionId: nul(f.version_id), x: num(f.x), y: num(f.y), z: num(f.z), alturaM: num(f.altura_m),
  rumboGrados: numNul(f.rumbo_grados), estado: f.estado === "inactivo" ? "inactivo" : "activo", motivo: txt(f.motivo),
  version: num(f.version), creado: txt(f.creado), creadoPor: txt(f.creado_por), creadoPorNombre: txt(f.creado_por_nombre),
  actualizado: txt(f.actualizado), actualizadoPor: nul(f.actualizado_por),
});
const deCaptura = (f: Fila): Captura => ({
  id: txt(f.id), projectId: txt(f.project_id), puntoId: txt(f.punto_id), tomadaEn: txt(f.tomada_en), observaciones: txt(f.observaciones),
  estado: (["subiendo", "lista", "error", "anulada"].includes(txt(f.estado)) ? f.estado : "error") as Captura["estado"],
  motivo: txt(f.motivo), inspectorId: txt(f.inspector_id), inspectorNombre: txt(f.inspector_nombre),
  creado: txt(f.creado), actualizado: txt(f.actualizado), actualizadoPor: nul(f.actualizado_por),
  giroGrados: Number(f.giro_grados) || 0, giroPor: nul(f.giro_por), giroEn: nul(f.giro_en),
});
const deFoto = (f: Fila): Foto => ({
  id: txt(f.id), projectId: txt(f.project_id), capturaId: txt(f.captura_id), tipo: f.tipo === "convencional" ? "convencional" : "360",
  nombreArchivo: txt(f.nombre_archivo), nombreOriginal: txt(f.nombre_original), tamano: num(f.tamano), ancho: numNul(f.ancho), alto: numNul(f.alto),
  miniatura: txt(f.miniatura), rutaTemporal: nul(f.ruta_temporal), cdeCarpetaId: nul(f.cde_carpeta_id), cdeFileId: nul(f.cde_file_id),
  cdeVersionId: nul(f.cde_version_id), estado: (["subiendo", "en_cde", "error"].includes(txt(f.estado)) ? f.estado : "error") as Foto["estado"],
  error: txt(f.error), creado: txt(f.creado), actualizado: txt(f.actualizado),
});
const deConfig = (f: Fila): ConfigI360 => ({
  codigoProyecto: nul(f.codigo_proyecto), carpetaNombre: txt(f.carpeta_nombre) || CARPETA_INICIAL,
  editores: Array.isArray(f.editores) ? (f.editores as unknown[]).map(String) : [], version: num(f.version),
  actualizado: nul(f.actualizado), actualizadoPor: nul(f.actualizado_por),
});

// -------------------------------------------------------------------- Supabase

function claveServidor(): { url: string; headers: Record<string, string> } | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { url: rawUrl.replace(/\/+$/, ""), headers };
}

const ruta = (r: string) => r.split("/").map(encodeURIComponent).join("/");

function almacenSupabase(): ArchivosI360 | null {
  const clave = claveServidor();
  if (!clave) return null;
  const base = `${clave.url}/storage/v1`;
  async function call(path: string, init: RequestInit, segundos = 20): Promise<Response> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...clave!.headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(segundos * 1000),
      cache: "no-store",
    });
    if (res.ok || res.status === 404 || res.status === 400) return res;
    const body = await res.text().catch(() => "");
    if (/bucket not found/i.test(body)) throw new StoreError(`Falta el bucket "${BUCKET}" en Supabase Storage: ejecuta de nuevo supabase/inspeccion-360.sql.`);
    throw new StoreError(`Supabase Storage respondió ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return {
    disponible: true,
    async firmarSubida(r) {
      const res = await call(`/object/upload/sign/${BUCKET}/${ruta(r)}`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      const datos = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !datos.url) throw new StoreError(`Supabase Storage no entregó el enlace de subida${datos.message ? `: ${datos.message}` : ""}.`);
      return `${base}${datos.url}`;
    },
    async leer(r) {
      // A photo can weigh 60 MB: give it time.
      const res = await call(`/object/authenticated/${BUCKET}/${ruta(r)}`, { method: "GET" }, 120);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
    async borrar(rutas) {
      if (rutas.length) await call(`/object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: rutas }), headers: { "Content-Type": "application/json" } });
    },
  };
}

function supabaseStore(): I360Store | null {
  const db = clienteSupabase((status, body, detail) => {
    if (detail.code === "23505") return new Repetido(detail.message ?? "Repetido");
    return faltaTabla(body) || /PGRST204|42703/.test(body) ? new StoreError(SETUP_HINT) : null;
  });
  const archivos = almacenSupabase();
  if (!db || !archivos) return null;
  const { json, all } = db;
  const ret = { Prefer: "return=representation" };
  const primera = <T>(filas: Fila[], de: (f: Fila) => T, que: string): T => {
    if (!filas[0]) throw new StoreError(`No se encontró ${que}.`, 404);
    return de(filas[0]);
  };
  const enLista = (ids: string[]) => `in.(${ids.map((i) => encodeURIComponent(i)).join(",")})`;
  return {
    archivos,
    async getConfig(projectId) {
      const filas = await json<Fila[]>(`/i360_config?project_id=${eq(projectId)}&select=*`);
      return filas[0] ? deConfig(filas[0]) : null;
    },
    async saveConfig(projectId, c, version, quien) {
      const fila = { codigo_proyecto: c.codigoProyecto, carpeta_nombre: c.carpetaNombre, editores: c.editores, version: version + 1, actualizado: new Date().toISOString(), actualizado_por: quien };
      if (version === 0) {
        try {
          return primera(await json<Fila[]>(`/i360_config`, { method: "POST", headers: ret, body: JSON.stringify({ project_id: projectId, ...fila }) }), deConfig, "la configuración");
        } catch (e) {
          if (e instanceof Repetido) throw new ConflictoVersion();
          throw e;
        }
      }
      const filas = await json<Fila[]>(`/i360_config?project_id=${eq(projectId)}&version=eq.${version}`, { method: "PATCH", headers: ret, body: JSON.stringify(fila) });
      if (!filas[0]) throw new ConflictoVersion();
      return deConfig(filas[0]);
    },
    async listarPuntos(projectId) {
      return (await all<Fila>(`/i360_puntos?project_id=${eq(projectId)}&select=*&order=torre,piso,unidad,numero`)).map(dePunto);
    },
    async obtenerPunto(projectId, id) {
      const filas = await json<Fila[]>(`/i360_puntos?project_id=${eq(projectId)}&id=${eq(id)}&select=*`);
      return filas[0] ? dePunto(filas[0]) : null;
    },
    async crearPunto(p) {
      return primera(await json<Fila[]>(`/i360_puntos`, { method: "POST", headers: ret, body: JSON.stringify(aFila(CAMPOS_PUNTO, p)) }), dePunto, "el punto");
    },
    async actualizarPunto(projectId, id, version, cambios) {
      const { id: _i, projectId: _p, codigo: _c, version: _v, ...resto } = cambios;
      const cuerpo = { ...aFila(CAMPOS_PUNTO, resto), version: version + 1, actualizado: new Date().toISOString() };
      const filas = await json<Fila[]>(`/i360_puntos?project_id=${eq(projectId)}&id=${eq(id)}&version=eq.${version}`, { method: "PATCH", headers: ret, body: JSON.stringify(cuerpo) });
      if (!filas[0]) throw new ConflictoVersion();
      return dePunto(filas[0]);
    },
    async listarCapturas(projectId, puntoId) {
      const filtro = puntoId ? `&punto_id=${eq(puntoId)}` : "";
      return (await all<Fila>(`/i360_capturas?project_id=${eq(projectId)}${filtro}&select=*&order=tomada_en.desc`)).map(deCaptura);
    },
    async obtenerCaptura(projectId, id) {
      const filas = await json<Fila[]>(`/i360_capturas?project_id=${eq(projectId)}&id=${eq(id)}&select=*`);
      return filas[0] ? deCaptura(filas[0]) : null;
    },
    async crearCaptura(c) {
      return primera(await json<Fila[]>(`/i360_capturas`, { method: "POST", headers: ret, body: JSON.stringify(aFila(CAMPOS_CAPTURA, c)) }), deCaptura, "la captura");
    },
    async actualizarCaptura(projectId, id, cambios) {
      const { id: _i, projectId: _p, ...resto } = cambios;
      const cuerpo = { ...aFila(CAMPOS_CAPTURA, resto), actualizado: new Date().toISOString() };
      return primera(await json<Fila[]>(`/i360_capturas?project_id=${eq(projectId)}&id=${eq(id)}`, { method: "PATCH", headers: ret, body: JSON.stringify(cuerpo) }), deCaptura, "la captura");
    },
    async alinearCaptura(projectId, id, anterior, giro, quien) {
      const ahora = new Date().toISOString();
      const cuerpo = { giro_grados: giro, giro_por: quien, giro_en: ahora, actualizado: ahora, actualizado_por: quien };
      const filas = await json<Fila[]>(`/i360_capturas?project_id=${eq(projectId)}&id=${eq(id)}&giro_grados=eq.${anterior}`, { method: "PATCH", headers: ret, body: JSON.stringify(cuerpo) });
      if (filas[0]) return deCaptura(filas[0]);
      const existe = await json<Fila[]>(`/i360_capturas?project_id=${eq(projectId)}&id=${eq(id)}&select=id`);
      if (!existe[0]) throw new StoreError("No se encontró la captura.", 404);
      throw new ConflictoVersion();
    },
    async fotosDe(projectId, capturaIds) {
      const salida: Foto[] = [];
      for (let i = 0; i < capturaIds.length; i += 100) {
        const lote = capturaIds.slice(i, i + 100);
        salida.push(...(await all<Fila>(`/i360_fotos?project_id=${eq(projectId)}&captura_id=${enLista(lote)}&select=*`)).map(deFoto));
      }
      return salida;
    },
    async obtenerFoto(projectId, id) {
      const filas = await json<Fila[]>(`/i360_fotos?project_id=${eq(projectId)}&id=${eq(id)}&select=*`);
      return filas[0] ? deFoto(filas[0]) : null;
    },
    async crearFoto(f) {
      return primera(await json<Fila[]>(`/i360_fotos`, { method: "POST", headers: ret, body: JSON.stringify(aFila(CAMPOS_FOTO, f)) }), deFoto, "la foto");
    },
    async actualizarFoto(projectId, id, cambios) {
      const { id: _i, projectId: _p, ...resto } = cambios;
      const cuerpo = { ...aFila(CAMPOS_FOTO, resto), actualizado: new Date().toISOString() };
      return primera(await json<Fila[]>(`/i360_fotos?project_id=${eq(projectId)}&id=${eq(id)}`, { method: "PATCH", headers: ret, body: JSON.stringify(cuerpo) }), deFoto, "la foto");
    },
    async nombresUsados(projectId, prefijo) {
      const filas = await json<Fila[]>(`/i360_fotos?project_id=${eq(projectId)}&nombre_archivo=like.${encodeURIComponent(prefijo.replace(/[%_]/g, "\\$&"))}*&select=nombre_archivo`);
      return filas.map((f) => txt(f.nombre_archivo));
    },
  } satisfies I360Store;
}

// -------------------------------------------------------------------- memory

export function archivosEnMemoria(): ArchivosI360 & { contenido: Map<string, Uint8Array> } {
  const contenido = new Map<string, Uint8Array>();
  return {
    disponible: false,
    contenido,
    async firmarSubida(r) {
      return `memoria://${BUCKET}/${r}`;
    },
    async leer(r) {
      return contenido.get(r) ?? null;
    },
    async borrar(rutas) {
      for (const r of rutas) contenido.delete(r);
    },
  };
}

export function memoryStore(archivos: ArchivosI360 = archivosEnMemoria()): I360Store {
  const configs = new Map<string, ConfigI360>();
  const puntos = new Map<string, Punto>();
  const capturas = new Map<string, Captura>();
  const fotos = new Map<string, Foto>();
  const copia = <T>(o: T): T => structuredClone(o);
  const ahora = () => new Date().toISOString();
  return {
    archivos,
    async getConfig(projectId) {
      const c = configs.get(projectId);
      return c ? copia(c) : null;
    },
    async saveConfig(projectId, c, version, quien) {
      const actual = configs.get(projectId);
      if ((actual?.version ?? 0) !== version) throw new ConflictoVersion();
      const nuevo: ConfigI360 = { ...c, version: version + 1, actualizado: ahora(), actualizadoPor: quien };
      configs.set(projectId, nuevo);
      return copia(nuevo);
    },
    async listarPuntos(projectId) {
      return [...puntos.values()]
        .filter((p) => p.projectId === projectId)
        .sort((a, b) => a.torre.localeCompare(b.torre) || a.piso.localeCompare(b.piso) || a.unidad.localeCompare(b.unidad) || a.numero - b.numero)
        .map(copia);
    },
    async obtenerPunto(projectId, id) {
      const p = puntos.get(id);
      return p && p.projectId === projectId ? copia(p) : null;
    },
    async crearPunto(p) {
      if ([...puntos.values()].some((o) => o.projectId === p.projectId && o.codigo === p.codigo)) throw new Repetido(p.codigo);
      puntos.set(p.id, copia(p));
      return copia(p);
    },
    async actualizarPunto(projectId, id, version, cambios) {
      const p = puntos.get(id);
      if (!p || p.projectId !== projectId || p.version !== version) throw new ConflictoVersion();
      const { id: _i, projectId: _p, codigo: _c, version: _v, ...resto } = cambios;
      const nuevo = { ...p, ...resto, version: version + 1, actualizado: ahora() };
      puntos.set(id, nuevo);
      return copia(nuevo);
    },
    async listarCapturas(projectId, puntoId) {
      return [...capturas.values()]
        .filter((c) => c.projectId === projectId && (!puntoId || c.puntoId === puntoId))
        .sort((a, b) => Date.parse(b.tomadaEn) - Date.parse(a.tomadaEn))
        .map(copia);
    },
    async obtenerCaptura(projectId, id) {
      const c = capturas.get(id);
      return c && c.projectId === projectId ? copia(c) : null;
    },
    async crearCaptura(c) {
      if (![...puntos.values()].some((p) => p.projectId === c.projectId && p.id === c.puntoId)) throw new StoreError("El punto no existe.", 404);
      capturas.set(c.id, copia(c));
      return copia(c);
    },
    async actualizarCaptura(projectId, id, cambios) {
      const c = capturas.get(id);
      if (!c || c.projectId !== projectId) throw new StoreError("No se encontró la captura.", 404);
      const nuevo = { ...c, ...cambios, id, projectId, actualizado: ahora() };
      capturas.set(id, nuevo);
      return copia(nuevo);
    },
    async alinearCaptura(projectId, id, anterior, giro, quien) {
      const c = capturas.get(id);
      if (!c || c.projectId !== projectId) throw new StoreError("No se encontró la captura.", 404);
      if (c.giroGrados !== anterior) throw new ConflictoVersion();
      const t = ahora();
      const nuevo = { ...c, giroGrados: giro, giroPor: quien, giroEn: t, actualizado: t, actualizadoPor: quien };
      capturas.set(id, nuevo);
      return copia(nuevo);
    },
    async fotosDe(projectId, capturaIds) {
      const ids = new Set(capturaIds);
      return [...fotos.values()].filter((f) => f.projectId === projectId && ids.has(f.capturaId)).map(copia);
    },
    async obtenerFoto(projectId, id) {
      const f = fotos.get(id);
      return f && f.projectId === projectId ? copia(f) : null;
    },
    async crearFoto(f) {
      fotos.set(f.id, copia(f));
      return copia(f);
    },
    async actualizarFoto(projectId, id, cambios) {
      const f = fotos.get(id);
      if (!f || f.projectId !== projectId) throw new StoreError("No se encontró la foto.", 404);
      const nuevo = { ...f, ...cambios, id, projectId, actualizado: ahora() };
      fotos.set(id, nuevo);
      return copia(nuevo);
    },
    async nombresUsados(projectId, prefijo) {
      return [...fotos.values()].filter((f) => f.projectId === projectId && f.nombreArchivo.startsWith(prefijo)).map((f) => f.nombreArchivo);
    },
  };
}

let memoria: I360Store | null = null;

/** Supabase when the server has it configured; otherwise one in-memory store per server process. */
export function i360Store(): I360Store {
  const s = supabaseStore();
  if (s) return s;
  memoria ??= memoryStore();
  return memoria;
}
