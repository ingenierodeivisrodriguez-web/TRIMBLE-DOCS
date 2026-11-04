import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { Asignacion, CarpetaFlujo, EntradaHistorial, Flujo, PasoFlujo } from "./types";

/**
 * Persistence of "Flujo de aprobación". Two implementations with the same
 * rules: Supabase (tables of supabase/flujo-aprobacion.sql through its REST
 * API, with the server-only key) and memory (for `next dev` without a
 * database and for tests). Nothing is ever deleted: flows and assignments are
 * deactivated and the history only grows. The database itself refuses a
 * repeated title in a project, a folder in two active flows, and a save over
 * a newer version.
 */
export interface FlujoStore {
  /** Every flow of the project, active or not. */
  flujos(proyecto: string): Promise<Flujo[]>;
  flujo(id: string): Promise<Flujo | null>;
  crearFlujo(f: Omit<Flujo, "id" | "version">): Promise<Flujo>;
  /** Saves only while `version` is the stored one: null when someone saved before. */
  actualizarFlujo(id: string, version: number, cambios: Partial<Omit<Flujo, "id" | "version" | "proyecto" | "creado" | "creadoPor">>): Promise<Flujo | null>;
  /** Every assignment of the project (active or not). */
  asignaciones(proyecto: string): Promise<Asignacion[]>;
  crearAsignaciones(a: Omit<Asignacion, "id">[]): Promise<Asignacion[]>;
  desactivarAsignaciones(ids: string[]): Promise<void>;
  registrar(e: Omit<EntradaHistorial, "id" | "creado">): Promise<void>;
  /** Newest first; of one flow when given. */
  historial(proyecto: string, filtro: { flujoId?: string; limite: number }): Promise<EntradaHistorial[]>;
}

const SETUP_HINT = "La base de datos de Flujo de aprobación no está lista: ejecuta supabase/flujo-aprobacion.sql en el SQL Editor de Supabase.";
export const HITO_REPETIDO = "Ya hay un flujo con ese título o hito en el proyecto (activo o desactivado): usa otro, o activa ese.";
export const CARPETA_OCUPADA = "Una de las carpetas de revisión ya está en otro flujo activo: una carpeta solo puede estar en un flujo activo.";

type Fila = Record<string, unknown>;
const t = (v: unknown) => (typeof v === "string" ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const deFlujo = (f: Fila): Flujo => ({
  id: String(f.id),
  proyecto: String(f.proyecto),
  hito: String(f.hito),
  hitoClave: String(f.hito_clave),
  pasos: arr<PasoFlujo>(f.pasos),
  carpetas: arr<CarpetaFlujo>(f.carpetas),
  destino: f.destino as CarpetaFlujo,
  activo: f.activo !== false,
  version: Number(f.version),
  creado: String(f.creado),
  creadoPor: t(f.creado_por),
  actualizado: String(f.actualizado),
  actualizadoPor: t(f.actualizado_por),
});
const aFlujo = (f: Partial<Flujo>): Fila =>
  sinIndefinidos({
    proyecto: f.proyecto,
    hito: f.hito,
    hito_clave: f.hitoClave,
    pasos: f.pasos,
    carpetas: f.carpetas,
    destino: f.destino,
    activo: f.activo,
    creado: f.creado,
    creado_por: f.creadoPor,
    actualizado: f.actualizado,
    actualizado_por: f.actualizadoPor,
  });

const deAsignacion = (f: Fila): Asignacion => ({
  id: String(f.id),
  flujoId: String(f.flujo_id),
  proyecto: String(f.proyecto),
  objetivoTipo: f.objetivo_tipo === "archivo" ? "archivo" : "carpeta",
  objetivoId: String(f.objetivo_id),
  objetivoRuta: t(f.objetivo_ruta) ?? "",
  objetivoAncestros: arr<string>(f.objetivo_ancestros),
  papel: String(f.papel),
  quienTipo: f.quien_tipo === "grupo" ? "grupo" : "persona",
  quienId: String(f.quien_id),
  quienNombre: t(f.quien_nombre) ?? "",
  activa: f.activa !== false,
  creado: String(f.creado),
  creadoPor: t(f.creado_por),
});
const aAsignacion = (a: Omit<Asignacion, "id">): Fila => ({
  flujo_id: a.flujoId,
  proyecto: a.proyecto,
  objetivo_tipo: a.objetivoTipo,
  objetivo_id: a.objetivoId,
  objetivo_ruta: a.objetivoRuta,
  objetivo_ancestros: a.objetivoAncestros,
  papel: a.papel,
  quien_tipo: a.quienTipo,
  quien_id: a.quienId,
  quien_nombre: a.quienNombre,
  activa: a.activa,
  creado: a.creado,
  creado_por: a.creadoPor,
});

const deEntrada = (f: Fila): EntradaHistorial => ({
  id: Number(f.id),
  creado: String(f.creado),
  proyecto: String(f.proyecto),
  flujoId: t(f.flujo_id),
  accion: String(f.accion),
  usuario: t(f.usuario),
  usuarioId: t(f.usuario_id),
  detalle: t(f.detalle) ?? "",
});

function sinIndefinidos(f: Fila): Fila {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

/** "a","b" -> "(a,b)" for PostgREST's in.(…) (ids are uuids: no commas or quotes). */
const lista = (ids: string[]) => `(${ids.map((x) => encodeURIComponent(x)).join(",")})`;

function supabaseStore(): FlujoStore | null {
  const db = clienteSupabase((status, body) => {
    if (/carpeta-en-otro-flujo/.test(body)) return new StoreError(CARPETA_OCUPADA, 409);
    if (/aprobacion_flujos_hito/.test(body)) return new StoreError(HITO_REPETIDO, 409);
    if (faltaTabla(body) || /PGRST204|42703/.test(body)) return new StoreError(SETUP_HINT);
    if (status === 409 || /23505/.test(body)) return new StoreError("Ya existe.", 409);
    return null;
  });
  if (!db) return null;
  const { call, json, all } = db;
  const representar = { Prefer: "return=representation" };
  return {
    async flujos(proyecto) {
      return (await all<Fila>(`/aprobacion_flujos?proyecto=${eq(proyecto)}&select=*&order=hito.asc`)).map(deFlujo);
    },
    async flujo(id) {
      const filas = await json<Fila[]>(`/aprobacion_flujos?id=${eq(id)}&select=*`);
      return filas[0] ? deFlujo(filas[0]) : null;
    },
    async crearFlujo(f) {
      const filas = await json<Fila[]>(`/aprobacion_flujos`, { method: "POST", headers: representar, body: JSON.stringify(aFlujo(f)) });
      if (!filas[0]) throw new StoreError("No se guardó el flujo.", 500);
      return deFlujo(filas[0]);
    },
    async actualizarFlujo(id, version, cambios) {
      const filas = await json<Fila[]>(`/aprobacion_flujos?id=${eq(id)}&version=eq.${version}`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ ...aFlujo(cambios), version: version + 1 }),
      });
      return filas[0] ? deFlujo(filas[0]) : null;
    },
    async asignaciones(proyecto) {
      return (await all<Fila>(`/aprobacion_asignaciones?proyecto=${eq(proyecto)}&select=*&order=creado.asc`)).map(deAsignacion);
    },
    async crearAsignaciones(a) {
      if (!a.length) return [];
      return (await json<Fila[]>(`/aprobacion_asignaciones`, { method: "POST", headers: representar, body: JSON.stringify(a.map(aAsignacion)) })).map(deAsignacion);
    },
    async desactivarAsignaciones(ids) {
      if (!ids.length) return;
      await call(`/aprobacion_asignaciones?id=in.${lista(ids)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ activa: false }) });
    },
    async registrar(e) {
      await call(`/aprobacion_historial`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ proyecto: e.proyecto, flujo_id: e.flujoId, accion: e.accion, usuario: e.usuario, usuario_id: e.usuarioId, detalle: e.detalle }),
      });
    },
    async historial(proyecto, filtro) {
      const deFlujoId = filtro.flujoId ? `&flujo_id=${eq(filtro.flujoId)}` : "";
      return (await json<Fila[]>(`/aprobacion_historial?proyecto=${eq(proyecto)}${deFlujoId}&select=*&order=creado.desc,id.desc&limit=${filtro.limite}`)).map(deEntrada);
    },
  };
}

// -------------------------------------------------------------------- memory

export function memoryStore(): FlujoStore {
  const flujos = new Map<string, Flujo>();
  const asignaciones = new Map<string, Asignacion>();
  const historial: EntradaHistorial[] = [];
  let contador = 0;
  const id = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;
  const copia = <T>(x: T): T => structuredClone(x);
  const ahora = () => new Date(Date.now() + contador).toISOString();

  /** What the database refuses: a repeated title, a folder in two active flows. */
  function revisar(f: Flujo) {
    const otros = [...flujos.values()].filter((x) => x.proyecto === f.proyecto && x.id !== f.id);
    if (otros.some((x) => x.hitoClave === f.hitoClave)) throw new StoreError(HITO_REPETIDO, 409);
    if (f.activo && otros.some((x) => x.activo && x.carpetas.some((c) => f.carpetas.some((n) => n.id === c.id)))) throw new StoreError(CARPETA_OCUPADA, 409);
  }

  return {
    async flujos(proyecto) {
      return [...flujos.values()].filter((f) => f.proyecto === proyecto).sort((a, b) => a.hito.localeCompare(b.hito)).map(copia);
    },
    async flujo(fid) {
      const f = flujos.get(fid);
      return f ? copia(f) : null;
    },
    async crearFlujo(f) {
      const nuevo: Flujo = { ...copia(f), id: id(), version: 1 };
      revisar(nuevo);
      flujos.set(nuevo.id, nuevo);
      return copia(nuevo);
    },
    async actualizarFlujo(fid, version, cambios) {
      const f = flujos.get(fid);
      if (!f || f.version !== version) return null;
      const nuevo: Flujo = { ...f, ...(sinIndefinidos(copia(cambios) as Fila) as Partial<Flujo>), version: version + 1 };
      revisar(nuevo);
      flujos.set(fid, nuevo);
      return copia(nuevo);
    },
    async asignaciones(proyecto) {
      return [...asignaciones.values()].filter((a) => a.proyecto === proyecto).map(copia);
    },
    async crearAsignaciones(lista) {
      const repetida = (a: Omit<Asignacion, "id">) =>
        a.activa && [...asignaciones.values()].some((x) => x.activa && x.flujoId === a.flujoId && x.objetivoId === a.objetivoId && x.papel === a.papel && x.quienTipo === a.quienTipo && x.quienId === a.quienId);
      if (lista.some(repetida)) throw new StoreError("Ya existe.", 409);
      return lista.map((a) => {
        const nueva = { ...copia(a), id: id() };
        asignaciones.set(nueva.id, nueva);
        return copia(nueva);
      });
    },
    async desactivarAsignaciones(ids) {
      for (const aid of ids) {
        const a = asignaciones.get(aid);
        if (a) asignaciones.set(aid, { ...a, activa: false });
      }
    },
    async registrar(e) {
      historial.push({ ...copia(e), id: historial.length + 1, creado: ahora() });
    },
    async historial(proyecto, filtro) {
      return historial
        .filter((e) => e.proyecto === proyecto && (!filtro.flujoId || e.flujoId === filtro.flujoId))
        .sort((a, b) => b.creado.localeCompare(a.creado) || b.id - a.id)
        .slice(0, filtro.limite)
        .map(copia);
    },
  };
}

let selected: FlujoStore | null | undefined;
let devStore: FlujoStore | undefined;

export function flujoStore(): FlujoStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError("La base de datos de Flujo de aprobación no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/flujo-aprobacion.sql y vuelve a desplegar.");
  }
  return (devStore ??= memoryStore());
}
