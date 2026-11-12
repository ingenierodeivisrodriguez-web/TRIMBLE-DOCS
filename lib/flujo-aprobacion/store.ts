import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { ConfigCorreo } from "./configCorreo";
import { ACCIONES_DECISION } from "./flujos";
import type { ArchivoFlujo, ArchivoRegistro, CarpetaFlujo, Comentario, EntradaHistorial, EstadoArchivo, Firma, Flujo, PasoFlujo, TareaTrimble, Traslado, VersionNueva } from "./types";

/**
 * Persistence of "Flujo de aprobación". Two implementations with the same
 * rules: Supabase (tables of supabase/flujo-aprobacion.sql through its REST
 * API, with the server-only key) and memory (for `next dev` without a
 * database and for tests). Nothing is ever deleted: flows are deactivated
 * and the history only grows. The database itself refuses a repeated title
 * in a project, a file in two active flows, and a save over a newer version.
 */
export interface FlujoStore {
  /** Every flow of the project, active or not. */
  flujos(proyecto: string): Promise<Flujo[]>;
  flujo(id: string): Promise<Flujo | null>;
  crearFlujo(f: Omit<Flujo, "id" | "version">): Promise<Flujo>;
  /** Saves only while `version` is the stored one: null when someone saved before. */
  actualizarFlujo(id: string, version: number, cambios: Partial<Omit<Flujo, "id" | "version" | "proyecto" | "creado" | "creadoPor">>): Promise<Flujo | null>;
  registrar(e: Omit<EntradaHistorial, "id" | "creado">): Promise<void>;
  /** Several lines at once (a first review may find hundreds of files). */
  registrarVarios(es: Omit<EntradaHistorial, "id" | "creado">[]): Promise<void>;
  /** Newest first; of one flow or one file when given. */
  historial(proyecto: string, filtro: { flujoId?: string; archivoId?: string; limite: number }): Promise<EntradaHistorial[]>;
  /** Every history line about a file in the project (for traceability), a page at a time. */
  historialArchivos(proyecto: string): Promise<EntradaHistorial[]>;
  /** The decision lines of the project's history (flow, action, when, who), oldest first: they close their flows. */
  decisiones(proyecto: string): Promise<Pick<EntradaHistorial, "id" | "flujoId" | "accion" | "creado" | "usuario">[]>;
  /** A flow's comments, oldest first. */
  comentarios(flujoId: string): Promise<Comentario[]>;
  agregarComentario(c: Omit<Comentario, "id" | "creado"> & { proyecto: string }): Promise<Comentario>;
  /** Takes the review of a flow's folders until `hasta`, unless someone else holds it (false). */
  tomarRevision(flujoId: string, hasta: string, ahora: string): Promise<boolean>;
  /** Releases it and notes when and by whom it was done. */
  terminarRevision(flujoId: string, momento: string, por: string): Promise<void>;
  /** Every registered file of the project. */
  archivos(proyecto: string): Promise<ArchivoRegistro[]>;
  crearArchivos(a: Omit<ArchivoRegistro, "id">[]): Promise<ArchivoRegistro[]>;
  actualizarArchivo(id: string, cambios: Partial<Omit<ArchivoRegistro, "id" | "proyecto" | "fileId">>): Promise<ArchivoRegistro>;
  /**
   * A decision: saves only while the file is still at the version, step and
   * state the person decided on (null when someone decided or a new version
   * arrived in between).
   */
  decidirArchivo(id: string, esperado: { versionId: string | null; pasoActual: number; estado: EstadoArchivo }, cambios: Partial<Omit<ArchivoRegistro, "id" | "proyecto" | "fileId">>): Promise<ArchivoRegistro | null>;
  /** Takes a file for copying it to the destination until `hasta`, unless someone else holds it (false). */
  tomarTraslado(id: string, hasta: string, ahora: string): Promise<boolean>;
  soltarTraslado(id: string): Promise<void>;
  /** The project's «Correos de aviso» as saved (the jsonb as it is), or null when never saved. */
  configCorreo(proyecto: string): Promise<{ datos: unknown; version: number; actualizado: string; actualizadoPor: string | null } | null>;
  /** Saves them while `version` is the stored one (0: none saved yet); false when someone saved before. */
  guardarConfigCorreo(proyecto: string, datos: ConfigCorreo, version: number, por: string, momento: string): Promise<boolean>;
}

const SETUP_HINT = "La base de datos de Flujo de aprobación no está lista: ejecuta supabase/flujo-aprobacion.sql en el SQL Editor de Supabase.";
export const HITO_REPETIDO = "Ya hay un flujo con ese título o hito en el proyecto (activo o desactivado): usa otro, o activa ese.";
export const CARPETA_OCUPADA = "Una de las carpetas de revisión ya está en otro flujo activo: una carpeta solo puede estar en un flujo activo.";
export const ARCHIVO_OCUPADO = "Uno de los archivos ya está en otro flujo activo: un archivo solo puede estar en un flujo activo.";

type Fila = Record<string, unknown>;
const t = (v: unknown) => (typeof v === "string" ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const deFlujo = (f: Fila): Flujo => ({
  id: String(f.id),
  proyecto: String(f.proyecto),
  hito: String(f.hito),
  hitoClave: String(f.hito_clave),
  pasos: arr<PasoFlujo>(f.pasos),
  archivos: arr<ArchivoFlujo>(f.archivos),
  carpetas: arr<CarpetaFlujo>(f.carpetas),
  destino: f.destino && typeof f.destino === "object" ? (f.destino as CarpetaFlujo) : null,
  activo: f.activo !== false,
  version: Number(f.version),
  creado: String(f.creado),
  creadoPor: t(f.creado_por),
  creadoPorId: t(f.creado_por_id),
  actualizado: String(f.actualizado),
  actualizadoPor: t(f.actualizado_por),
  revisado: t(f.revisado),
  revisadoPor: t(f.revisado_por),
  vence: t(f.vence),
  notas: t(f.notas) ?? "",
  codigo: f.codigo === null || f.codigo === undefined ? null : Number(f.codigo),
});

const deComentario = (f: Fila): Comentario => ({
  id: Number(f.id),
  creado: String(f.creado),
  flujoId: String(f.flujo_id),
  texto: String(f.texto),
  usuario: t(f.usuario),
  usuarioId: t(f.usuario_id),
});
const aFlujo = (f: Partial<Flujo>): Fila =>
  sinIndefinidos({
    proyecto: f.proyecto,
    hito: f.hito,
    hito_clave: f.hitoClave,
    pasos: f.pasos,
    archivos: f.archivos,
    carpetas: f.carpetas,
    destino: f.destino,
    activo: f.activo,
    creado: f.creado,
    creado_por: f.creadoPor,
    creado_por_id: f.creadoPorId,
    actualizado: f.actualizado,
    actualizado_por: f.actualizadoPor,
    vence: f.vence,
    notas: f.notas,
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
  archivoId: t(f.archivo_id),
  fileId: t(f.file_id),
  version: typeof f.version === "number" ? f.version : null,
  ocurrido: t(f.ocurrido),
});

const aEntrada = (e: Omit<EntradaHistorial, "id" | "creado">): Fila => ({
  proyecto: e.proyecto,
  flujo_id: e.flujoId,
  accion: e.accion,
  usuario: e.usuario,
  usuario_id: e.usuarioId,
  detalle: e.detalle,
  archivo_id: e.archivoId ?? null,
  file_id: e.fileId ?? null,
  version: e.version ?? null,
  ocurrido: e.ocurrido ?? null,
});

const ESTADOS: EstadoArchivo[] =["pendiente", "nueva-version", "aprobado", "rechazado", "retirado"];
const n = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined ? null : Number(v));

const deArchivo = (f: Fila): ArchivoRegistro => ({
  id: String(f.id),
  proyecto: String(f.proyecto),
  flujoId: String(f.flujo_id),
  fileId: String(f.file_id),
  nombre: String(f.nombre),
  ruta: t(f.ruta) ?? "",
  carpetaId: t(f.carpeta_id),
  ancestros: arr<string>(f.ancestros),
  tipo: t(f.tipo) ?? "",
  estado: ESTADOS.includes(f.estado as EstadoArchivo) ? (f.estado as EstadoArchivo) : "pendiente",
  pasos: arr<PasoFlujo>(f.pasos),
  pasoActual: Number(f.paso_actual ?? 0),
  versionId: t(f.version_id),
  revision: n(f.revision),
  subido: t(f.subido),
  subidoPor: t(f.subido_por) ?? "",
  subidoPorId: t(f.subido_por_id),
  firmas: arr<Firma>(f.firmas),
  traslado: f.traslado && typeof f.traslado === "object" ? (f.traslado as Traslado) : null,
  versionNueva: f.version_nueva && typeof f.version_nueva === "object" ? (f.version_nueva as VersionNueva) : null,
  tareas: arr<TareaTrimble>(f.tareas),
  versionAprobadaId: t(f.version_aprobada_id),
  revisionAprobada: n(f.revision_aprobada),
  detectado: String(f.detectado),
  actualizado: String(f.actualizado),
});
const aArchivo = (a: Partial<ArchivoRegistro>): Fila =>
  sinIndefinidos({
    proyecto: a.proyecto,
    flujo_id: a.flujoId,
    file_id: a.fileId,
    nombre: a.nombre,
    ruta: a.ruta,
    carpeta_id: a.carpetaId,
    ancestros: a.ancestros,
    tipo: a.tipo,
    estado: a.estado,
    pasos: a.pasos,
    paso_actual: a.pasoActual,
    version_id: a.versionId,
    revision: a.revision,
    subido: a.subido,
    subido_por: a.subidoPor,
    subido_por_id: a.subidoPorId,
    firmas: a.firmas,
    traslado: a.traslado,
    version_nueva: a.versionNueva,
    tareas: a.tareas,
    version_aprobada_id: a.versionAprobadaId,
    revision_aprobada: a.revisionAprobada,
    detectado: a.detectado,
    actualizado: a.actualizado,
  });

function sinIndefinidos(f: Fila): Fila {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

function supabaseStore(): FlujoStore | null {
  const db = clienteSupabase((status, body) => {
    if (/carpeta-en-otro-flujo/.test(body)) return new StoreError(CARPETA_OCUPADA, 409);
    if (/archivo-en-otro-flujo/.test(body)) return new StoreError(ARCHIVO_OCUPADO, 409);
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
    async registrar(e) {
      await call(`/aprobacion_historial`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(aEntrada(e)) });
    },
    async registrarVarios(es) {
      // Every row with the same keys, as PostgREST asks for a bulk insert.
      for (let i = 0; i < es.length; i += 500) {
        await call(`/aprobacion_historial`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(es.slice(i, i + 500).map(aEntrada)) });
      }
    },
    async historial(proyecto, filtro) {
      const deFlujoId = filtro.flujoId ? `&flujo_id=${eq(filtro.flujoId)}` : "";
      const deArchivoId = filtro.archivoId ? `&archivo_id=${eq(filtro.archivoId)}` : "";
      return (await json<Fila[]>(`/aprobacion_historial?proyecto=${eq(proyecto)}${deFlujoId}${deArchivoId}&select=*&order=creado.desc,id.desc&limit=${filtro.limite}`)).map(deEntrada);
    },
    async comentarios(flujoId) {
      return (await all<Fila>(`/aprobacion_comentarios?flujo_id=${eq(flujoId)}&select=*&order=id.asc`)).map(deComentario);
    },
    async agregarComentario(c) {
      const filas = await json<Fila[]>(`/aprobacion_comentarios`, {
        method: "POST",
        headers: representar,
        body: JSON.stringify({ proyecto: c.proyecto, flujo_id: c.flujoId, texto: c.texto, usuario: c.usuario, usuario_id: c.usuarioId }),
      });
      if (!filas[0]) throw new StoreError("No se guardó el comentario.", 500);
      return deComentario(filas[0]);
    },
    async historialArchivos(proyecto) {
      return (await all<Fila>(`/aprobacion_historial?proyecto=${eq(proyecto)}&archivo_id=not.is.null&select=*&order=id.asc`)).map(deEntrada);
    },
    async decisiones(proyecto) {
      const acciones = ACCIONES_DECISION.join(",");
      return (await all<Fila>(`/aprobacion_historial?proyecto=${eq(proyecto)}&accion=in.(${acciones})&flujo_id=not.is.null&select=id,flujo_id,accion,creado,usuario&order=id.asc`)).map((f) => ({
        id: Number(f.id),
        flujoId: t(f.flujo_id),
        accion: String(f.accion),
        creado: String(f.creado),
        usuario: t(f.usuario) ?? "",
      }));
    },
    async tomarRevision(flujoId, hasta, ahora) {
      const filas = await json<Fila[]>(`/aprobacion_flujos?id=${eq(flujoId)}&or=(revisando_hasta.is.null,revisando_hasta.lt.${encodeURIComponent(ahora)})`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ revisando_hasta: hasta }),
      });
      return filas.length > 0;
    },
    async terminarRevision(flujoId, momento, por) {
      await call(`/aprobacion_flujos?id=${eq(flujoId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revisando_hasta: null, revisado: momento, revisado_por: por }) });
    },
    async archivos(proyecto) {
      return (await all<Fila>(`/aprobacion_archivos?proyecto=${eq(proyecto)}&select=*&order=ruta.asc`)).map(deArchivo);
    },
    async crearArchivos(a) {
      if (!a.length) return [];
      const out: ArchivoRegistro[] = [];
      // In batches, so a big first review doesn't send one huge request.
      for (let i = 0; i < a.length; i += 200) {
        out.push(...(await json<Fila[]>(`/aprobacion_archivos`, { method: "POST", headers: representar, body: JSON.stringify(a.slice(i, i + 200).map(aArchivo)) })).map(deArchivo));
      }
      return out;
    },
    async actualizarArchivo(id, cambios) {
      const filas = await json<Fila[]>(`/aprobacion_archivos?id=${eq(id)}`, { method: "PATCH", headers: representar, body: JSON.stringify(aArchivo(cambios)) });
      if (!filas[0]) throw new StoreError("No se encontró el archivo.", 404);
      return deArchivo(filas[0]);
    },
    async decidirArchivo(id, esperado, cambios) {
      const version = esperado.versionId === null ? "version_id=is.null" : `version_id=${eq(esperado.versionId)}`;
      const filas = await json<Fila[]>(`/aprobacion_archivos?id=${eq(id)}&${version}&paso_actual=eq.${esperado.pasoActual}&estado=${eq(esperado.estado)}`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify(aArchivo(cambios)),
      });
      return filas[0] ? deArchivo(filas[0]) : null;
    },
    async tomarTraslado(id, hasta, ahora) {
      const filas = await json<Fila[]>(`/aprobacion_archivos?id=${eq(id)}&or=(traslado_hasta.is.null,traslado_hasta.lt.${encodeURIComponent(ahora)})`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ traslado_hasta: hasta }),
      });
      return filas.length > 0;
    },
    async soltarTraslado(id) {
      await call(`/aprobacion_archivos?id=${eq(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ traslado_hasta: null }) });
    },
    async configCorreo(proyecto) {
      const filas = await json<Fila[]>(`/aprobacion_config_correo?proyecto=${eq(proyecto)}&select=*`);
      const f = filas[0];
      return f ? { datos: f.datos, version: Number(f.version), actualizado: String(f.actualizado), actualizadoPor: t(f.actualizado_por) } : null;
    },
    async guardarConfigCorreo(proyecto, datos, version, por, momento) {
      if (version === 0) {
        // The first save; another administrator saving first makes it a repeated key.
        try {
          await call(`/aprobacion_config_correo`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ proyecto, datos, version: 1, actualizado: momento, actualizado_por: por }) });
          return true;
        } catch (err) {
          if (err instanceof StoreError && err.status === 409) return false;
          throw err;
        }
      }
      const filas = await json<Fila[]>(`/aprobacion_config_correo?proyecto=${eq(proyecto)}&version=eq.${version}`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ datos, version: version + 1, actualizado: momento, actualizado_por: por }),
      });
      return filas.length > 0;
    },
  };
}

// -------------------------------------------------------------------- memory

export function memoryStore(): FlujoStore {
  const flujos = new Map<string, Flujo>();
  const historial: EntradaHistorial[] = [];
  const comentarios: Comentario[] = [];
  const archivos = new Map<string, ArchivoRegistro>();
  const revisando = new Map<string, string>();
  const trasladando = new Map<string, string>();
  const correos = new Map<string, { datos: unknown; version: number; actualizado: string; actualizadoPor: string | null }>();
  let contador = 0;
  const id = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;
  const copia = <T>(x: T): T => structuredClone(x);
  const ahora = () => new Date(Date.now() + contador).toISOString();

  /** What the database refuses: a repeated title, a folder or a file in two active flows. */
  function revisar(f: Flujo) {
    const otros = [...flujos.values()].filter((x) => x.proyecto === f.proyecto && x.id !== f.id);
    if (otros.some((x) => x.hitoClave === f.hitoClave)) throw new StoreError(HITO_REPETIDO, 409);
    if (f.activo && otros.some((x) => x.activo && x.carpetas.some((c) => f.carpetas.some((n) => n.id === c.id)))) throw new StoreError(CARPETA_OCUPADA, 409);
    if (f.activo && otros.some((x) => x.activo && x.archivos.some((c) => f.archivos.some((n) => n.id === c.id)))) throw new StoreError(ARCHIVO_OCUPADO, 409);
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
      // Like the database trigger: the next number of its project.
      const codigo = Math.max(0, ...[...flujos.values()].filter((x) => x.proyecto === f.proyecto).map((x) => x.codigo ?? 0)) + 1;
      const nuevo: Flujo = { ...copia(f), id: id(), version: 1, codigo };
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
    async registrar(e) {
      historial.push({ ...copia(e), id: historial.length + 1, creado: ahora() });
    },
    async registrarVarios(es) {
      for (const e of es) historial.push({ ...copia(e), id: historial.length + 1, creado: ahora() });
    },
    async historial(proyecto, filtro) {
      return historial
        .filter((e) => e.proyecto === proyecto && (!filtro.flujoId || e.flujoId === filtro.flujoId) && (!filtro.archivoId || e.archivoId === filtro.archivoId))
        .sort((a, b) => b.creado.localeCompare(a.creado) || b.id - a.id)
        .slice(0, filtro.limite)
        .map(copia);
    },
    async comentarios(flujoId) {
      return comentarios.filter((c) => c.flujoId === flujoId).map(copia);
    },
    async agregarComentario(c) {
      const nuevo: Comentario = { id: comentarios.length + 1, creado: ahora(), flujoId: c.flujoId, texto: c.texto, usuario: c.usuario, usuarioId: c.usuarioId };
      comentarios.push(nuevo);
      return copia(nuevo);
    },
    async historialArchivos(proyecto) {
      return historial.filter((e) => e.proyecto === proyecto && e.archivoId).map(copia);
    },
    async decisiones(proyecto) {
      return historial
        .filter((e) => e.proyecto === proyecto && e.flujoId && ACCIONES_DECISION.includes(e.accion))
        .map((e) => ({ id: e.id, flujoId: e.flujoId, accion: e.accion, creado: e.creado, usuario: e.usuario }));
    },
    async tomarRevision(fid, hasta, momento) {
      const actual = revisando.get(fid);
      if (!flujos.has(fid) || (actual && actual >= momento)) return false;
      revisando.set(fid, hasta);
      return true;
    },
    async terminarRevision(fid, momento, por) {
      revisando.delete(fid);
      const f = flujos.get(fid);
      if (f) flujos.set(fid, { ...f, revisado: momento, revisadoPor: por });
    },
    async archivos(proyecto) {
      return [...archivos.values()].filter((a) => a.proyecto === proyecto).sort((a, b) => a.ruta.localeCompare(b.ruta)).map(copia);
    },
    async crearArchivos(lista) {
      if (lista.some((a) => [...archivos.values()].some((x) => x.proyecto === a.proyecto && x.fileId === a.fileId))) throw new StoreError("Ya existe.", 409);
      return lista.map((a) => {
        const nuevo = { ...copia(a), id: id() };
        archivos.set(nuevo.id, nuevo);
        return copia(nuevo);
      });
    },
    async actualizarArchivo(aid, cambios) {
      const a = archivos.get(aid);
      if (!a) throw new StoreError("No se encontró el archivo.", 404);
      const nuevo = { ...a, ...(sinIndefinidos(copia(cambios) as Fila) as Partial<ArchivoRegistro>) };
      archivos.set(aid, nuevo);
      return copia(nuevo);
    },
    async decidirArchivo(aid, esperado, cambios) {
      const a = archivos.get(aid);
      if (!a || a.versionId !== esperado.versionId || a.pasoActual !== esperado.pasoActual || a.estado !== esperado.estado) return null;
      const nuevo = { ...a, ...(sinIndefinidos(copia(cambios) as Fila) as Partial<ArchivoRegistro>) };
      archivos.set(aid, nuevo);
      return copia(nuevo);
    },
    async tomarTraslado(aid, hasta, momento) {
      const actual = trasladando.get(aid);
      if (!archivos.has(aid) || (actual && actual >= momento)) return false;
      trasladando.set(aid, hasta);
      return true;
    },
    async soltarTraslado(aid) {
      trasladando.delete(aid);
    },
    async configCorreo(proyecto) {
      const c = correos.get(proyecto);
      return c ? copia(c) : null;
    },
    async guardarConfigCorreo(proyecto, datos, version, por, momento) {
      if ((correos.get(proyecto)?.version ?? 0) !== version) return false;
      correos.set(proyecto, { datos: copia(datos), version: version + 1, actualizado: momento, actualizadoPor: por });
      return true;
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
