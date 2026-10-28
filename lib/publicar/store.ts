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
  /** The active reception folders that expect publications from this project (in other projects). */
  recepcionesDeOrigen(origen: string): Promise<Recepcion[]>;
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
  // The technical account (one row) and its pending sign-ins.
  getCuenta(): Promise<CuentaTecnica | null>;
  guardarCuenta(c: Omit<CuentaTecnica, "conectadaEn" | "renovadaEn">): Promise<void>;
  /** After renewing: the new tokens (refresh tokens are single-use). */
  guardarTokens(t: { refreshCifrado: string; accessCifrado: string; accessExpira: string }): Promise<void>;
  borrarCuenta(): Promise<void>;
  /** Takes the turn to renew the session for some seconds (false: someone else has it). */
  tomarTurno(segundos: number): Promise<boolean>;
  soltarTurno(): Promise<void>;
  crearEstado(e: EstadoOauth): Promise<void>;
  /** The pending sign-in with that state, once (null when unknown or expired). */
  consumirEstado(state: string): Promise<EstadoOauth | null>;
}

export interface CuentaTecnica {
  refreshCifrado: string;
  accessCifrado: string | null;
  accessExpira: string | null;
  cuentaId: string | null;
  cuentaNombre: string;
  cuentaEmail: string;
  conectadaPor: string | null;
  conectadaEn: string;
  renovadaEn: string;
}

export interface EstadoOauth {
  state: string;
  verifier: string;
  redirectUri: string;
  creadoPor: string | null;
  expira: string;
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
  destinoNombre: t(f.destino_nombre) ?? "",
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
    destino_nombre: r.destinoNombre,
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

const deCuenta = (f: Fila): CuentaTecnica => ({
  refreshCifrado: String(f.refresh_cifrado),
  accessCifrado: t(f.access_cifrado),
  accessExpira: t(f.access_expira),
  cuentaId: t(f.cuenta_id),
  cuentaNombre: t(f.cuenta_nombre) ?? "",
  cuentaEmail: t(f.cuenta_email) ?? "",
  conectadaPor: t(f.conectada_por),
  conectadaEn: String(f.conectada_en),
  renovadaEn: String(f.renovada_en),
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
    async recepcionesDeOrigen(origen) {
      return (await all<Fila>(`/publicar_recepciones?origen_proyecto=${eq(origen)}&activa=is.true&select=*&order=destino_nombre.asc`)).map(deRecepcion);
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
    async getCuenta() {
      const f = (await json<Fila[]>(`/publicar_cuenta?id=eq.1&select=*`))[0];
      return f ? deCuenta(f) : null;
    },
    async guardarCuenta(c) {
      const ahora = new Date().toISOString();
      await call(`/publicar_cuenta?on_conflict=id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: 1,
          refresh_cifrado: c.refreshCifrado,
          access_cifrado: c.accessCifrado,
          access_expira: c.accessExpira,
          cuenta_id: c.cuentaId,
          cuenta_nombre: c.cuentaNombre,
          cuenta_email: c.cuentaEmail,
          conectada_por: c.conectadaPor,
          conectada_en: ahora,
          renovada_en: ahora,
          turno_hasta: null,
        }),
      });
    },
    async guardarTokens(tk) {
      await call(`/publicar_cuenta?id=eq.1`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ refresh_cifrado: tk.refreshCifrado, access_cifrado: tk.accessCifrado, access_expira: tk.accessExpira, renovada_en: new Date().toISOString(), turno_hasta: null }),
      });
    },
    async borrarCuenta() {
      await call(`/publicar_cuenta?id=eq.1`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    async tomarTurno(segundos) {
      const ahora = new Date();
      const filas = await json<Fila[]>(`/publicar_cuenta?id=eq.1&or=(turno_hasta.is.null,turno_hasta.lt.${encodeURIComponent(ahora.toISOString())})`, {
        method: "PATCH",
        headers: representar,
        body: JSON.stringify({ turno_hasta: new Date(ahora.getTime() + segundos * 1000).toISOString() }),
      });
      return filas.length > 0;
    },
    async soltarTurno() {
      await call(`/publicar_cuenta?id=eq.1`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ turno_hasta: null }) });
    },
    async crearEstado(e) {
      // Old unfinished sign-ins go away first.
      await call(`/publicar_oauth_estados?expira=lt.${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
      await call(`/publicar_oauth_estados`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ state: e.state, verifier: e.verifier, redirect_uri: e.redirectUri, creado_por: e.creadoPor, expira: e.expira }),
      });
    },
    async consumirEstado(state) {
      const filas = await json<Fila[]>(`/publicar_oauth_estados?state=${eq(state)}`, { method: "DELETE", headers: representar });
      const f = filas[0];
      if (!f || Date.parse(String(f.expira)) < Date.now()) return null;
      return { state: String(f.state), verifier: String(f.verifier), redirectUri: String(f.redirect_uri), creadoPor: t(f.creado_por), expira: String(f.expira) };
    },
  };
}

// -------------------------------------------------------------------- memory

export function memoryStore(): PublicarStore {
  const recepciones = new Map<string, Recepcion>();
  const publicaciones = new Map<string, Publicacion>();
  const archivos = new Map<string, ArchivoSeguido>();
  const actividad: EntradaActividad[] = [];
  let cuenta: (CuentaTecnica & { turnoHasta: number | null }) | null = null;
  const estados = new Map<string, EstadoOauth>();
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
    async recepcionesDeOrigen(origen) {
      return [...recepciones.values()].filter((r) => r.origenProyecto === origen && r.activa).sort((a, b) => a.destinoNombre.localeCompare(b.destinoNombre)).map(copia);
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
    async getCuenta() {
      if (!cuenta) return null;
      const { turnoHasta: _t, ...c } = cuenta;
      return copia(c);
    },
    async guardarCuenta(c) {
      const momento = new Date().toISOString();
      cuenta = { ...c, conectadaEn: momento, renovadaEn: momento, turnoHasta: null };
    },
    async guardarTokens(tk) {
      if (cuenta) cuenta = { ...cuenta, ...tk, renovadaEn: new Date().toISOString(), turnoHasta: null };
    },
    async borrarCuenta() {
      cuenta = null;
    },
    async tomarTurno(segundos) {
      if (!cuenta || (cuenta.turnoHasta && cuenta.turnoHasta > Date.now())) return false;
      cuenta.turnoHasta = Date.now() + segundos * 1000;
      return true;
    },
    async soltarTurno() {
      if (cuenta) cuenta.turnoHasta = null;
    },
    async crearEstado(e) {
      estados.set(e.state, { ...e });
    },
    async consumirEstado(state) {
      const e = estados.get(state);
      estados.delete(state);
      return e && Date.parse(e.expira) >= Date.now() ? { ...e } : null;
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
