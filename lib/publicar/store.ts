import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { ArchivoSeguido, EntradaActividad, Publicacion, Recepcion } from "./types";

/**
 * Persistence of "Publicar entre proyectos". Two implementations with the
 * same rules: Supabase (tables of supabase/publicar.sql through its REST API,
 * with the server-only key) and memory (for `next dev` without a database and
 * for tests). Nothing is ever deleted: reception folders are deactivated,
 * publications stopped and the activity only grows.
 */
export interface PublicarStore {
  /** The reception folders of a destination project (active or not). */
  recepciones(destino: string): Promise<Recepcion[]>;
  recepcion(destino: string, origen: string): Promise<Recepcion | null>;
  /** Creates or replaces the one for (destination, origin). */
  guardarRecepcion(r: Omit<Recepcion, "id">): Promise<Recepcion>;
  /** Publications where the project is the origin or the destination. */
  publicaciones(proyecto: string): Promise<Publicacion[]>;
  publicacion(id: string): Promise<Publicacion | null>;
  buscarPublicacion(origen: string, destino: string, itemId: string): Promise<Publicacion | null>;
  crearPublicacion(p: Omit<Publicacion, "id">): Promise<Publicacion>;
  actualizarPublicacion(id: string, cambios: Partial<Omit<Publicacion, "id">>): Promise<Publicacion>;
  archivos(publicacionIds: string[]): Promise<ArchivoSeguido[]>;
  archivo(id: string): Promise<ArchivoSeguido | null>;
  crearArchivo(a: Omit<ArchivoSeguido, "id">): Promise<ArchivoSeguido>;
  actualizarArchivo(id: string, cambios: Partial<Omit<ArchivoSeguido, "id">>): Promise<ArchivoSeguido>;
  /** Takes the file for copying until `hasta`, unless someone else holds it (false). */
  tomarArchivo(id: string, hasta: string, ahora: string): Promise<boolean>;
  registrar(e: Omit<EntradaActividad, "id" | "creado">): Promise<void>;
  /** The project's activity (as origin or destination), newest first. */
  actividad(proyecto: string, filtro: { desde?: string; hasta?: string; limite: number }): Promise<EntradaActividad[]>;
}

const SETUP_HINT = "La base de datos de Publicar entre proyectos no está lista: ejecuta supabase/publicar.sql en el SQL Editor de Supabase.";

type Fila = Record<string, unknown>;
const t = (v: unknown) => (typeof v === "string" ? v : null);
const n = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined ? null : Number(v));

const deRecepcion = (f: Fila): Recepcion => ({
  id: String(f.id),
  destinoProyecto: String(f.destino_proyecto),
  origenProyecto: String(f.origen_proyecto),
  origenNombre: t(f.origen_nombre) ?? "",
  carpetaId: String(f.carpeta_id),
  carpetaRuta: t(f.carpeta_ruta) ?? "",
  activa: f.activa !== false,
  actualizado: String(f.actualizado),
  actualizadoPor: t(f.actualizado_por),
  actualizadoPorId: t(f.actualizado_por_id),
});
const aRecepcion = (r: Partial<Recepcion>): Fila =>
  sinIndefinidos({
    destino_proyecto: r.destinoProyecto,
    origen_proyecto: r.origenProyecto,
    origen_nombre: r.origenNombre,
    carpeta_id: r.carpetaId,
    carpeta_ruta: r.carpetaRuta,
    activa: r.activa,
    actualizado: r.actualizado,
    actualizado_por: r.actualizadoPor,
    actualizado_por_id: r.actualizadoPorId,
  });

const dePublicacion = (f: Fila): Publicacion => ({
  id: String(f.id),
  origenProyecto: String(f.origen_proyecto),
  origenNombre: t(f.origen_nombre) ?? "",
  destinoProyecto: String(f.destino_proyecto),
  destinoNombre: t(f.destino_nombre) ?? "",
  tipo: f.tipo === "carpeta" ? "carpeta" : "archivo",
  itemId: String(f.item_id),
  nombre: String(f.nombre),
  ruta: t(f.ruta) ?? "",
  estado: f.estado === "detenida" || f.estado === "retirada" ? f.estado : "activa",
  destinoCarpetaId: t(f.destino_carpeta_id),
  destinoCarpetaRuta: t(f.destino_carpeta_ruta) ?? "",
  nota: t(f.nota) ?? "",
  publicado: String(f.publicado),
  publicadoPor: t(f.publicado_por),
  publicadoPorId: t(f.publicado_por_id),
  revisado: t(f.revisado),
});
const aPublicacion = (p: Partial<Publicacion>): Fila =>
  sinIndefinidos({
    origen_proyecto: p.origenProyecto,
    origen_nombre: p.origenNombre,
    destino_proyecto: p.destinoProyecto,
    destino_nombre: p.destinoNombre,
    tipo: p.tipo,
    item_id: p.itemId,
    nombre: p.nombre,
    ruta: p.ruta,
    estado: p.estado,
    destino_carpeta_id: p.destinoCarpetaId,
    destino_carpeta_ruta: p.destinoCarpetaRuta,
    nota: p.nota,
    publicado: p.publicado,
    publicado_por: p.publicadoPor,
    publicado_por_id: p.publicadoPorId,
    revisado: p.revisado,
  });

const deArchivo = (f: Fila): ArchivoSeguido => ({
  id: String(f.id),
  publicacionId: String(f.publicacion_id),
  origenFileId: String(f.origen_file_id),
  nombre: String(f.nombre),
  subcarpeta: t(f.subcarpeta) ?? "",
  origenVersionId: t(f.origen_version_id),
  origenRevision: n(f.origen_revision),
  destinoFileId: t(f.destino_file_id),
  destinoVersionId: t(f.destino_version_id),
  destinoRevision: n(f.destino_revision),
  estado: (["pendiente", "al-dia", "diferencia", "retirado", "error"].includes(String(f.estado)) ? f.estado : "pendiente") as ArchivoSeguido["estado"],
  mensaje: t(f.mensaje) ?? "",
  enCursoHasta: t(f.en_curso_hasta),
  copiandoUploadId: t(f.copiando_upload_id),
  copiandoVersionId: t(f.copiando_version_id),
  copiandoRevision: n(f.copiando_revision),
  diferenciaVersionId: t(f.diferencia_version_id),
  actualizado: String(f.actualizado),
});
const aArchivo = (a: Partial<ArchivoSeguido>): Fila =>
  sinIndefinidos({
    publicacion_id: a.publicacionId,
    origen_file_id: a.origenFileId,
    nombre: a.nombre,
    subcarpeta: a.subcarpeta,
    origen_version_id: a.origenVersionId,
    origen_revision: a.origenRevision,
    destino_file_id: a.destinoFileId,
    destino_version_id: a.destinoVersionId,
    destino_revision: a.destinoRevision,
    estado: a.estado,
    mensaje: a.mensaje,
    en_curso_hasta: a.enCursoHasta,
    copiando_upload_id: a.copiandoUploadId,
    copiando_version_id: a.copiandoVersionId,
    copiando_revision: a.copiandoRevision,
    diferencia_version_id: a.diferenciaVersionId,
    actualizado: a.actualizado,
  });

const deEntrada = (f: Fila): EntradaActividad => ({
  id: Number(f.id),
  creado: String(f.creado),
  origenProyecto: String(f.origen_proyecto),
  destinoProyecto: String(f.destino_proyecto),
  origenNombre: t(f.origen_nombre) ?? "",
  destinoNombre: t(f.destino_nombre) ?? "",
  publicacionId: t(f.publicacion_id),
  accion: String(f.accion) as EntradaActividad["accion"],
  usuario: t(f.usuario),
  usuarioId: t(f.usuario_id),
  nombre: t(f.nombre) ?? "",
  versionOrigen: n(f.version_origen),
  versionDestino: n(f.version_destino),
  nota: t(f.nota) ?? "",
  resultado: f.resultado === "aviso" || f.resultado === "error" ? f.resultado : "ok",
});

function sinIndefinidos(f: Fila): Fila {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

/** "a","b" -> "(a,b)" for PostgREST's in.(…) (ids are uuids or Trimble ids: no commas or quotes). */
const lista = (ids: string[]) => `(${ids.map((x) => encodeURIComponent(x)).join(",")})`;

function supabaseStore(): PublicarStore | null {
  const db = clienteSupabase((status, body) => {
    if (faltaTabla(body) || /PGRST204|42703/.test(body)) return new StoreError(SETUP_HINT);
    if (status === 409 || /23505/.test(body)) return new StoreError("Ya existe.", 409);
    return null;
  });
  if (!db) return null;
  const { call, json, all } = db;
  const representar = { Prefer: "return=representation" };
  const una = <T>(filas: Fila[], de: (f: Fila) => T, que: string): T => {
    if (!filas[0]) throw new StoreError(`No se encontró ${que}.`, 404);
    return de(filas[0]);
  };
  return {
    async recepciones(destino) {
      return (await all<Fila>(`/publicar_recepciones?destino_proyecto=${eq(destino)}&select=*&order=origen_nombre.asc`)).map(deRecepcion);
    },
    async recepcion(destino, origen) {
      const filas = await json<Fila[]>(`/publicar_recepciones?destino_proyecto=${eq(destino)}&origen_proyecto=${eq(origen)}&select=*`);
      return filas[0] ? deRecepcion(filas[0]) : null;
    },
    async guardarRecepcion(r) {
      const filas = await json<Fila[]>(`/publicar_recepciones?on_conflict=destino_proyecto,origen_proyecto`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(aRecepcion(r)),
      });
      return una(filas, deRecepcion, "la carpeta de recepción");
    },
    async publicaciones(proyecto) {
      return (await all<Fila>(`/publicar_publicaciones?or=(origen_proyecto.eq.${encodeURIComponent(proyecto)},destino_proyecto.eq.${encodeURIComponent(proyecto)})&select=*&order=publicado.desc`)).map(dePublicacion);
    },
    async publicacion(id) {
      const filas = await json<Fila[]>(`/publicar_publicaciones?id=${eq(id)}&select=*`);
      return filas[0] ? dePublicacion(filas[0]) : null;
    },
    async buscarPublicacion(origen, destino, itemId) {
      const filas = await json<Fila[]>(`/publicar_publicaciones?origen_proyecto=${eq(origen)}&destino_proyecto=${eq(destino)}&item_id=${eq(itemId)}&select=*`);
      return filas[0] ? dePublicacion(filas[0]) : null;
    },
    async crearPublicacion(p) {
      return una(await json<Fila[]>(`/publicar_publicaciones`, { method: "POST", headers: representar, body: JSON.stringify(aPublicacion(p)) }), dePublicacion, "la publicación");
    },
    async actualizarPublicacion(id, cambios) {
      return una(
        await json<Fila[]>(`/publicar_publicaciones?id=${eq(id)}`, { method: "PATCH", headers: representar, body: JSON.stringify(aPublicacion(cambios)) }),
        dePublicacion,
        "la publicación"
      );
    },
    async archivos(publicacionIds) {
      if (!publicacionIds.length) return [];
      return (await all<Fila>(`/publicar_archivos?publicacion_id=in.${lista(publicacionIds)}&select=*&order=nombre.asc`)).map(deArchivo);
    },
    async archivo(id) {
      const filas = await json<Fila[]>(`/publicar_archivos?id=${eq(id)}&select=*`);
      return filas[0] ? deArchivo(filas[0]) : null;
    },
    async crearArchivo(a) {
      return una(await json<Fila[]>(`/publicar_archivos`, { method: "POST", headers: representar, body: JSON.stringify(aArchivo(a)) }), deArchivo, "el archivo");
    },
    async actualizarArchivo(id, cambios) {
      return una(await json<Fila[]>(`/publicar_archivos?id=${eq(id)}`, { method: "PATCH", headers: representar, body: JSON.stringify(aArchivo(cambios)) }), deArchivo, "el archivo");
    },
    async tomarArchivo(id, hasta, ahora) {
      const filas = await json<Fila[]>(`/publicar_archivos?id=${eq(id)}&or=(en_curso_hasta.is.null,en_curso_hasta.lt.${encodeURIComponent(ahora)})`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ en_curso_hasta: hasta }),
      });
      return filas.length > 0;
    },
    async registrar(e) {
      await call(`/publicar_actividad`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          origen_proyecto: e.origenProyecto,
          destino_proyecto: e.destinoProyecto,
          origen_nombre: e.origenNombre,
          destino_nombre: e.destinoNombre,
          publicacion_id: e.publicacionId,
          accion: e.accion,
          usuario: e.usuario,
          usuario_id: e.usuarioId,
          nombre: e.nombre,
          version_origen: e.versionOrigen,
          version_destino: e.versionDestino,
          nota: e.nota,
          resultado: e.resultado,
        }),
      });
    },
    async actividad(proyecto, filtro) {
      const p = encodeURIComponent(proyecto);
      const fechas = [filtro.desde ? `&creado=gte.${encodeURIComponent(filtro.desde)}` : "", filtro.hasta ? `&creado=lt.${encodeURIComponent(filtro.hasta)}` : ""].join("");
      return (await json<Fila[]>(`/publicar_actividad?or=(origen_proyecto.eq.${p},destino_proyecto.eq.${p})${fechas}&select=*&order=creado.desc,id.desc&limit=${filtro.limite}`)).map(deEntrada);
    },
  };
}

// -------------------------------------------------------------------- memory

export function memoryStore(): PublicarStore {
  const recepciones = new Map<string, Recepcion>();
  const publicaciones = new Map<string, Publicacion>();
  const archivos = new Map<string, ArchivoSeguido>();
  const actividad: EntradaActividad[] = [];
  let contador = 0;
  const id = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;
  const copia = <T>(x: T): T => structuredClone(x);
  const ahora = () => new Date(Date.now() + contador).toISOString();
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre);
  return {
    async recepciones(destino) {
      return [...recepciones.values()].filter((r) => r.destinoProyecto === destino).sort((a, b) => a.origenNombre.localeCompare(b.origenNombre)).map(copia);
    },
    async recepcion(destino, origen) {
      const r = [...recepciones.values()].find((x) => x.destinoProyecto === destino && x.origenProyecto === origen);
      return r ? copia(r) : null;
    },
    async guardarRecepcion(r) {
      const previa = [...recepciones.values()].find((x) => x.destinoProyecto === r.destinoProyecto && x.origenProyecto === r.origenProyecto);
      const nueva = { ...r, id: previa?.id ?? id() };
      recepciones.set(nueva.id, nueva);
      return copia(nueva);
    },
    async publicaciones(proyecto) {
      return [...publicaciones.values()].filter((p) => p.origenProyecto === proyecto || p.destinoProyecto === proyecto).sort((a, b) => b.publicado.localeCompare(a.publicado)).map(copia);
    },
    async publicacion(pid) {
      const p = publicaciones.get(pid);
      return p ? copia(p) : null;
    },
    async buscarPublicacion(origen, destino, itemId) {
      const p = [...publicaciones.values()].find((x) => x.origenProyecto === origen && x.destinoProyecto === destino && x.itemId === itemId);
      return p ? copia(p) : null;
    },
    async crearPublicacion(p) {
      if ([...publicaciones.values()].some((x) => x.origenProyecto === p.origenProyecto && x.destinoProyecto === p.destinoProyecto && x.itemId === p.itemId)) throw new StoreError("Ya existe.", 409);
      const nueva = { ...p, id: id() };
      publicaciones.set(nueva.id, nueva);
      return copia(nueva);
    },
    async actualizarPublicacion(pid, cambios) {
      const p = publicaciones.get(pid);
      if (!p) throw new StoreError("No se encontró la publicación.", 404);
      const nueva = { ...p, ...sinIndefinidos(cambios as Fila) } as Publicacion;
      publicaciones.set(pid, nueva);
      return copia(nueva);
    },
    async archivos(ids) {
      return [...archivos.values()].filter((a) => ids.includes(a.publicacionId)).sort(porNombre).map(copia);
    },
    async archivo(aid) {
      const a = archivos.get(aid);
      return a ? copia(a) : null;
    },
    async crearArchivo(a) {
      if ([...archivos.values()].some((x) => x.publicacionId === a.publicacionId && x.origenFileId === a.origenFileId)) throw new StoreError("Ya existe.", 409);
      const nuevo = { ...a, id: id() };
      archivos.set(nuevo.id, nuevo);
      return copia(nuevo);
    },
    async actualizarArchivo(aid, cambios) {
      const a = archivos.get(aid);
      if (!a) throw new StoreError("No se encontró el archivo.", 404);
      const nuevo = { ...a, ...sinIndefinidos(cambios as Fila) } as ArchivoSeguido;
      archivos.set(aid, nuevo);
      return copia(nuevo);
    },
    async tomarArchivo(aid, hasta, momento) {
      const a = archivos.get(aid);
      if (!a || (a.enCursoHasta && a.enCursoHasta >= momento)) return false;
      archivos.set(aid, { ...a, enCursoHasta: hasta });
      return true;
    },
    async registrar(e) {
      actividad.push({ ...e, id: actividad.length + 1, creado: ahora() });
    },
    async actividad(proyecto, filtro) {
      return actividad
        .filter((e) => (e.origenProyecto === proyecto || e.destinoProyecto === proyecto) && (!filtro.desde || e.creado >= filtro.desde) && (!filtro.hasta || e.creado < filtro.hasta))
        .sort((a, b) => b.creado.localeCompare(a.creado) || b.id - a.id)
        .slice(0, filtro.limite)
        .map(copia);
    },
  };
}

let selected: PublicarStore | null | undefined;
let devStore: PublicarStore | undefined;

export function publicarStore(): PublicarStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError("La base de datos de Publicar entre proyectos no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/publicar.sql y vuelve a desplegar.");
  }
  return (devStore ??= memoryStore());
}
