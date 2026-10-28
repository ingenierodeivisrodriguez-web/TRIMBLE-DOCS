/**
 * "Publicar entre proyectos": the destination's reception folders, the
 * publications and their files, keeping them up to date, and the activity.
 *
 * Copies need one user who belongs to both projects: with their connected
 * account when it is (so copies don't wait for them to open the extension),
 * otherwise with the token of whoever opens the extension (in the origin or
 * the destination), if they belong to both.
 * Publishing to a project one isn't a member of needs its consent: an
 * active reception folder for this project. A copy never
 * replaces silently what someone changed in the destination: it stays as a
 * "diferencia" until a person decides. Nothing is deleted anywhere.
 */
import { buscarEnCarpeta, ClienteTrimble, crearCarpeta, estadoSubida, explicarEstado, leerCarpeta } from "../compras/cde";
import { fechaHora } from "../compras/formato";
import type { Caller } from "../propiedades/service";
import { ArchivoTrimble, copiarUltimaVersion, Lado, leerArchivo, situacionDe } from "./copiar";
import { esIdTrimble, PublicarError } from "./errores";
import type { PublicarStore } from "./store";
import type { AccionActividad, ArchivoSeguido, Comprobacion, EntradaActividad, PasoArchivo, PlanSincronizacion, Publicacion, PublicacionInfo, Recepcion, Tarea } from "./types";

export type { PasoArchivo };

export interface Ctx {
  /** The project the extension is open in. */
  projectId: string;
  caller: Caller;
  store: PublicarStore;
  deps: {
    /** This project through the caller's token. */
    aqui: Lado;
    /** Another project through the caller's token; throws when they can't see it. */
    abrir(projectId: string): Promise<Lado>;
    /** A project's name; throws when the caller can't see it. */
    nombreProyecto(projectId: string): Promise<string>;
    /** The technical account, when the server has it set up. */
    tecnico?: {
      /** Its e-mail, or null when it isn't connected; throws when its session lapsed. */
      cuenta(): Promise<{ email: string } | null>;
      abrir(projectId: string): Promise<Lado>;
      nombreProyecto(projectId: string): Promise<string>;
    };
    fetch?: typeof fetch;
    ahora?: () => Date;
  };
}

/** How long a file stays taken while it's copied (and while Trimble confirms an upload). */
const MINUTOS_COPIA = 10;
const MINUTOS_SUBIDA = 15;
/** At most this many files are followed in one published folder. */
export const LIMITE_ARCHIVOS = 2000;
const MAX_NOTA = 500;

const ahoraDe = (ctx: Ctx) => ctx.deps.ahora?.() ?? new Date();
const iso = (ctx: Ctx, minutos = 0) => new Date(ahoraDe(ctx).getTime() + minutos * 60_000).toISOString();

function ladoDe(ctx: Ctx, projectId: string): Promise<Lado> {
  return projectId === ctx.projectId ? Promise.resolve(ctx.deps.aqui) : ctx.deps.abrir(projectId);
}

/** A project's name, read with the caller's token or else the connected account's. */
async function nombreDe(ctx: Ctx, projectId: string, porDefecto = ""): Promise<string> {
  for (const leer of [ctx.deps.nombreProyecto, ctx.deps.tecnico?.nombreProyecto]) {
    if (!leer) continue;
    try {
      const nombre = await leer(projectId);
      if (nombre) return nombre;
    } catch {
      // not visible with that token
    }
  }
  return porDefecto || projectId;
}

/**
 * Which session copies between two projects: the connected account (its
 * e-mail in `conectada`) when it belongs to both, else the caller when they
 * do; otherwise why not.
 */
async function ladosPara(ctx: Ctx, origen: string, destino: string): Promise<{ o: Lado; d: Lado; conectada: string | null } | { aviso: string }> {
  const ambos = async (abrir: (id: string) => Promise<Lado>) => {
    try {
      const [o, d] = await Promise.all([abrir(origen), abrir(destino)]);
      return { o, d };
    } catch {
      return null;
    }
  };
  let cuenta: { email: string } | null = null;
  let fallo = "";
  const t = ctx.deps.tecnico;
  if (t) {
    try {
      cuenta = await t.cuenta();
    } catch (err) {
      fallo = err instanceof Error ? err.message : String(err);
    }
    if (cuenta) {
      const r = await ambos((id) => t.abrir(id));
      if (r) return { ...r, conectada: cuenta.email };
    }
  }
  const r = await ambos((id) => ladoDe(ctx, id));
  if (r) return { ...r, conectada: null };
  if (fallo) return { aviso: fallo.replace(/\.$/, "") };
  return {
    aviso: cuenta
      ? `hace falta un usuario que pertenezca a los dos proyectos, y la cuenta conectada (${cuenta.email}) aún no es miembro de uno de ellos: invítala en el que le falte`
      : "hace falta un usuario que pertenezca a los dos proyectos: se copia cuando esa persona abre la extensión, o siempre si conecta su cuenta en la pestaña «Usuario en ambos proyectos»",
  };
}

function idDe(v: unknown, que: string): string {
  if (!esIdTrimble(v)) throw new PublicarError(`Falta ${que} o no es válido.`);
  return v;
}

async function registrar(
  ctx: Ctx,
  base: { origenProyecto: string; destinoProyecto: string; origenNombre: string; destinoNombre: string; publicacionId?: string | null },
  accion: AccionActividad,
  extra: Partial<Pick<EntradaActividad, "nombre" | "versionOrigen" | "versionDestino" | "nota" | "resultado">> = {}
) {
  await ctx.store.registrar({
    origenProyecto: base.origenProyecto,
    destinoProyecto: base.destinoProyecto,
    origenNombre: base.origenNombre,
    destinoNombre: base.destinoNombre,
    publicacionId: base.publicacionId ?? null,
    accion,
    usuario: ctx.caller.name,
    usuarioId: ctx.caller.id,
    nombre: extra.nombre ?? "",
    versionOrigen: extra.versionOrigen ?? null,
    versionDestino: extra.versionDestino ?? null,
    nota: extra.nota ?? "",
    resultado: extra.resultado ?? "ok",
  });
}

// ---------------------------------------------------------------- Trimble helpers

/** "Proyecto / Planos / Estructura": the way down to a folder, with the project's name at its root. */
async function rutaCarpeta(c: ClienteTrimble, folderId: string, nombreProyecto: string): Promise<string> {
  const r = await c.pedir("GET", `/folders/${encodeURIComponent(folderId)}?fields=path`);
  const o = (r.cuerpo ?? {}) as { name?: unknown; path?: { id?: unknown; name?: unknown }[]; parentId?: unknown };
  const ancestros = Array.isArray(o.path) ? o.path.filter((p) => typeof p?.name === "string" && p.id !== folderId).map((p) => String(p.name)) : [];
  if (!o.parentId && !ancestros.length) return nombreProyecto;
  return [nombreProyecto, ...ancestros.slice(1), typeof o.name === "string" ? o.name : ""].filter(Boolean).join(" / ");
}

interface ItemTrimble {
  id: string;
  nombre: string;
  tipo: "FILE" | "FOLDER";
  versionId: string | null;
  revision: number | null;
}

/** Every item of a folder, a page at a time (Range header). */
async function itemsDe(c: ClienteTrimble, folderId: string): Promise<ItemTrimble[] | null> {
  const todos: ItemTrimble[] = [];
  for (let inicio = 0; ; inicio += 200) {
    const r = await c.pedir("GET", `/folders/${encodeURIComponent(folderId)}/items`, { encabezados: { Range: `items=${inicio}-${inicio + 199}` } });
    if (r.estado === 404) return inicio === 0 ? null : todos;
    if (r.estado < 200 || r.estado >= 300 || !Array.isArray(r.cuerpo)) throw new PublicarError(`No se pudo leer una carpeta en Trimble: ${explicarEstado(r.estado)}`, 502);
    const pagina = r.cuerpo as Record<string, unknown>[];
    if (pagina.length && todos.some((x) => x.id === pagina[0]?.id)) break;
    for (const x of pagina) {
      if (typeof x.id !== "string" || (x.type !== "FILE" && x.type !== "FOLDER")) continue;
      todos.push({ id: x.id, nombre: String(x.name ?? ""), tipo: x.type, versionId: typeof x.versionId === "string" ? x.versionId : null, revision: typeof x.revision === "number" ? x.revision : null });
    }
    if (pagina.length < 200) break;
  }
  return todos;
}

interface EnOrigen {
  fileId: string;
  nombre: string;
  subcarpeta: string;
  versionId: string | null;
  revision: number | null;
}

/** What a publication covers in the origin now (null: it isn't there any more). */
async function contenidoEnOrigen(c: ClienteTrimble, p: Publicacion): Promise<{ archivos: EnOrigen[]; completo: boolean } | null> {
  if (p.tipo === "archivo") {
    const { archivo, respuesta } = await leerArchivo(c, p.itemId);
    if (!archivo) {
      if (respuesta.estado === 404) return null;
      throw new PublicarError(`No se pudo leer “${p.nombre}” en el origen: ${explicarEstado(respuesta.estado)}`, 502);
    }
    return { archivos: [{ fileId: archivo.id, nombre: archivo.nombre, subcarpeta: "", versionId: archivo.versionId, revision: archivo.revision }], completo: true };
  }
  const archivos: EnOrigen[] = [];
  const pendientes: { id: string; ruta: string; nivel: number }[] = [{ id: p.itemId, ruta: "", nivel: 0 }];
  while (pendientes.length) {
    const actual = pendientes.shift()!;
    const items = await itemsDe(c, actual.id);
    if (!items) {
      if (actual.nivel === 0) return null;
      continue;
    }
    for (const it of items) {
      if (it.tipo === "FOLDER") {
        if (actual.nivel < 20) pendientes.push({ id: it.id, ruta: actual.ruta ? `${actual.ruta}/${it.nombre}` : it.nombre, nivel: actual.nivel + 1 });
      } else {
        if (archivos.length >= LIMITE_ARCHIVOS) return { archivos, completo: false };
        archivos.push({ fileId: it.id, nombre: it.nombre, subcarpeta: actual.ruta, versionId: it.versionId, revision: it.revision });
      }
    }
  }
  return { archivos, completo: true };
}

/** The subfolder `nombre` of a folder, created if it isn't there (null: Trimble refused). */
async function asegurarCarpeta(c: ClienteTrimble, padreId: string, nombre: string): Promise<string | null> {
  const existente = await buscarEnCarpeta(c, padreId, nombre, "FOLDER");
  if (existente) return existente.id;
  const { carpeta: padre } = await leerCarpeta(c, padreId);
  if (!padre) return null;
  return (await crearCarpeta(c, padre, nombre)).carpeta?.id ?? null;
}

/** "Estructura/Detalles" under a folder, creating what's missing. */
async function asegurarRuta(c: ClienteTrimble, baseId: string, subcarpeta: string): Promise<string | null> {
  let actual: string | null = baseId;
  for (const parte of subcarpeta.split("/").filter(Boolean)) {
    if (!actual) return null;
    actual = await asegurarCarpeta(c, actual, parte);
  }
  return actual;
}

// ---------------------------------------------------------------- reception folders (this project is the destination)

export async function getRecepciones(ctx: Ctx): Promise<{ esAdmin: boolean; recepciones: Recepcion[] }> {
  return { esAdmin: ctx.caller.isAdmin, recepciones: await ctx.store.recepciones(ctx.projectId) };
}

function exigirAdmin(ctx: Ctx) {
  if (!ctx.caller.isAdmin) throw new PublicarError("Solo un administrador de este proyecto define las carpetas de recepción.", 403, "no-admin");
}

/** { origen, carpetaId, origenNombre? }: where what `origen` publishes here arrives (administrators). */
export async function guardarRecepcion(ctx: Ctx, body: unknown) {
  exigirAdmin(ctx);
  const o = (body ?? {}) as Record<string, unknown>;
  const origen = idDe(o.origen, "el proyecto origen");
  const carpetaId = idDe(o.carpetaId, "la carpeta");
  if (origen === ctx.projectId) throw new PublicarError("El proyecto origen debe ser otro proyecto.");
  const c = ctx.deps.aqui.cliente;
  const { carpeta, respuesta } = await leerCarpeta(c, carpetaId);
  if (!carpeta) throw new PublicarError(`No se pudo leer la carpeta: ${explicarEstado(respuesta.estado)}`, 404);
  if (carpeta.permiso === "READ") throw new PublicarError("Solo tienes lectura en esa carpeta: elige una donde se puedan subir archivos.");
  const [nombreAqui, origenNombre] = await Promise.all([nombreDe(ctx, ctx.projectId), nombreDe(ctx, origen, typeof o.origenNombre === "string" ? o.origenNombre.trim().slice(0, 200) : "")]);
  const carpetaRuta = await rutaCarpeta(c, carpeta.id, nombreAqui);
  const previa = await ctx.store.recepcion(ctx.projectId, origen);
  await ctx.store.guardarRecepcion({
    destinoProyecto: ctx.projectId,
    origenProyecto: origen,
    origenNombre,
    destinoNombre: nombreAqui,
    carpetaId: carpeta.id,
    carpetaRuta,
    activa: true,
    actualizado: iso(ctx),
    actualizadoPor: ctx.caller.name,
    actualizadoPorId: ctx.caller.id,
  });
  const nota = previa?.activa && previa.carpetaId !== carpeta.id ? `Carpeta de recepción cambiada a ${carpetaRuta} (antes ${previa.carpetaRuta}). Lo ya publicado sigue donde está.` : `Carpeta de recepción: ${carpetaRuta}.`;
  await registrar(ctx, { origenProyecto: origen, destinoProyecto: ctx.projectId, origenNombre, destinoNombre: nombreAqui }, "recepcion", { nombre: origenNombre, nota });
  return getRecepciones(ctx);
}

/** { origen }: stops receiving from that project (the definition stays, inactive). */
export async function desactivarRecepcion(ctx: Ctx, body: unknown) {
  exigirAdmin(ctx);
  const origen = idDe((body as Record<string, unknown> | null)?.origen, "el proyecto origen");
  const r = await ctx.store.recepcion(ctx.projectId, origen);
  if (!r) throw new PublicarError("No hay carpeta de recepción para ese proyecto.", 404);
  if (r.activa) {
    await ctx.store.guardarRecepcion({ ...r, activa: false, actualizado: iso(ctx), actualizadoPor: ctx.caller.name, actualizadoPorId: ctx.caller.id });
    await registrar(ctx, { origenProyecto: origen, destinoProyecto: ctx.projectId, origenNombre: r.origenNombre, destinoNombre: await nombreDe(ctx, ctx.projectId) }, "recepcion-desactivada", {
      nombre: r.origenNombre,
      nota: "Las publicaciones nuevas de ese proyecto esperan otra carpeta; las ya copiadas siguen actualizándose donde están.",
    });
  }
  return getRecepciones(ctx);
}

// ---------------------------------------------------------------- publishing (this project is the origin)

/** Where publishing to `destino` would arrive (the caller must belong to it). */
export async function recepcionHacia(ctx: Ctx, destino: string): Promise<{ destinoNombre: string; recepcion: Recepcion | null }> {
  idDe(destino, "el proyecto destino");
  const miembro = await ctx.deps.abrir(destino).then(
    () => true,
    () => false
  );
  const r = await ctx.store.recepcion(destino, ctx.projectId);
  const activa = r?.activa ? r : null;
  if (!miembro && !activa) throw new PublicarError("No eres miembro de ese proyecto y no ha definido una carpeta de recepción para este proyecto.", 403, "sin-acceso");
  return { destinoNombre: await nombreDe(ctx, destino, activa?.destinoNombre), recepcion: activa };
}

/** { destino, items: [{ tipo, id }], nota }: publishes files and folders of this project there. */
export async function publicar(ctx: Ctx, body: unknown): Promise<{ publicadas: string[]; avisos: string[] }> {
  const o = (body ?? {}) as Record<string, unknown>;
  const destino = idDe(o.destino, "el proyecto destino");
  if (destino === ctx.projectId) throw new PublicarError("Elige otro proyecto: se publica en un proyecto distinto.");
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length || items.length > 200) throw new PublicarError("Elige entre 1 y 200 archivos o carpetas.");
  const nota = typeof o.nota === "string" ? o.nota.trim() : "";
  if (nota.length > MAX_NOTA) throw new PublicarError(`La nota puede tener hasta ${MAX_NOTA} caracteres.`);
  // Publishing where one isn't a member needs the destination's consent: its reception folder for this project.
  const miembro = await ctx.deps.abrir(destino).then(
    () => true,
    () => false
  );
  const recepcion = await ctx.store.recepcion(destino, ctx.projectId);
  if (!miembro && !recepcion?.activa) {
    throw new PublicarError("Ese proyecto no ha definido una carpeta de recepción para este proyecto: pide a su administrador que la defina en «Recibido en este proyecto».", 403, "sin-recepcion");
  }
  const [origenNombre, destinoNombre] = await Promise.all([nombreDe(ctx, ctx.projectId), nombreDe(ctx, destino, recepcion?.destinoNombre)]);
  // The destination's administrator may not see this project: give its reception folder the real name.
  if (recepcion && (!recepcion.origenNombre || recepcion.origenNombre === ctx.projectId) && origenNombre !== ctx.projectId) {
    const { id: _id, ...resto } = recepcion;
    await ctx.store.guardarRecepcion({ ...resto, origenNombre });
  }
  const c = ctx.deps.aqui.cliente;
  const publicadas: string[] = [];
  const avisos: string[] = [];
  for (const raw of items) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const tipo = it.tipo === "carpeta" ? "carpeta" : it.tipo === "archivo" ? "archivo" : null;
    if (!tipo) throw new PublicarError("Cada elemento debe ser un archivo o una carpeta.");
    const id = idDe(it.id, "el archivo o la carpeta");
    let nombre: string;
    let ruta: string;
    if (tipo === "archivo") {
      const { archivo } = await leerArchivo(c, id);
      if (!archivo) {
        avisos.push("Un archivo elegido ya no está en este proyecto.");
        continue;
      }
      nombre = archivo.nombre;
      ruta = archivo.padreId ? `${await rutaCarpeta(c, archivo.padreId, origenNombre)} / ${nombre}` : nombre;
    } else {
      const { carpeta } = await leerCarpeta(c, id);
      if (!carpeta) {
        avisos.push("Una carpeta elegida ya no está en este proyecto.");
        continue;
      }
      nombre = carpeta.nombre;
      ruta = await rutaCarpeta(c, id, origenNombre);
    }
    const existente = await ctx.store.buscarPublicacion(ctx.projectId, destino, id);
    if (existente?.estado === "activa") {
      avisos.push(`“${nombre}” ya está publicado en ${destinoNombre}.`);
      continue;
    }
    const datos = { origenNombre, destinoNombre, nombre, ruta, estado: "activa" as const, nota, publicado: iso(ctx), publicadoPor: ctx.caller.name, publicadoPorId: ctx.caller.id };
    const p = existente
      ? await ctx.store.actualizarPublicacion(existente.id, datos)
      : await ctx.store.crearPublicacion({ ...datos, origenProyecto: ctx.projectId, destinoProyecto: destino, tipo, itemId: id, destinoCarpetaId: null, destinoCarpetaRuta: "", revisado: null });
    await registrar(ctx, { ...p, publicacionId: p.id }, "publicar", {
      nombre: tipo === "carpeta" ? `${nombre} (carpeta)` : nombre,
      nota: nota || (existente ? "Publicado otra vez." : ""),
    });
    publicadas.push(p.id);
  }
  return { publicadas, avisos };
}

/** The publications from or to this project, with their files. */
export async function getPublicaciones(ctx: Ctx): Promise<{ esAdmin: boolean; yo: string; publicaciones: PublicacionInfo[] }> {
  const pubs = await ctx.store.publicaciones(ctx.projectId);
  const archivos = await ctx.store.archivos(pubs.map((p) => p.id));
  return { esAdmin: ctx.caller.isAdmin, yo: ctx.caller.id, publicaciones: pubs.map((p) => ({ ...p, archivos: archivos.filter((a) => a.publicacionId === p.id) })) };
}

async function publicacionDeAqui(ctx: Ctx, id: string): Promise<Publicacion> {
  const p = await ctx.store.publicacion(id);
  if (!p || (p.origenProyecto !== ctx.projectId && p.destinoProyecto !== ctx.projectId)) throw new PublicarError("No se encontró la publicación.", 404);
  return p;
}

/** { id, accion: "detener" | "reanudar" }: whoever published it, or an administrator of this project. */
export async function cambiarEstado(ctx: Ctx, body: unknown) {
  const o = (body ?? {}) as Record<string, unknown>;
  const p = await publicacionDeAqui(ctx, String(o.id ?? ""));
  if (p.publicadoPorId !== ctx.caller.id && !ctx.caller.isAdmin) throw new PublicarError("Solo quien la publicó o un administrador del proyecto puede detenerla o reanudarla.", 403, "no-autorizado");
  if (o.accion === "detener" && p.estado === "activa") {
    await ctx.store.actualizarPublicacion(p.id, { estado: "detenida" });
    await registrar(ctx, { ...p, publicacionId: p.id }, "detener", { nombre: p.nombre, nota: "Deja de actualizarse; lo copiado queda en el destino." });
  } else if (o.accion === "reanudar" && p.estado === "detenida") {
    await ctx.store.actualizarPublicacion(p.id, { estado: "activa" });
    await registrar(ctx, { ...p, publicacionId: p.id }, "reanudar", { nombre: p.nombre });
  } else {
    throw new PublicarError(p.estado === "retirada" ? "Esa publicación ya no está en el origen." : "Esa publicación ya está así.");
  }
  return getPublicaciones(ctx);
}

// ---------------------------------------------------------------- keeping them up to date

/** { paso: "plan" | "copiar" | "confirmar" | "reemplazar", archivoId?, siVersion? } */
export async function sincronizar(ctx: Ctx, body: unknown) {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.paso === "plan") return plan(ctx);
  if (o.paso === "copiar") return copiarArchivo(ctx, idDe(o.archivoId, "el archivo"), null);
  if (o.paso === "reemplazar") return copiarArchivo(ctx, idDe(o.archivoId, "el archivo"), idDe(o.siVersion, "la versión vista"));
  if (o.paso === "confirmar") return confirmar(ctx, idDe(o.archivoId, "el archivo"));
  throw new PublicarError("Paso no válido.");
}

const nombreCompleto = (a: { subcarpeta: string; nombre: string }) => (a.subcarpeta ? `${a.subcarpeta}/${a.nombre}` : a.nombre);

/**
 * Reviews the active publications from or to this project: fixes where each
 * one lives in the destination (its reception folder, plus a folder of its
 * name for a published folder), lists what the origin has now, and leaves as
 * tasks the files never copied or with a newer version. Files gone from the
 * origin are marked "retirado" (the destination keeps its copy).
 */
async function plan(ctx: Ctx): Promise<PlanSincronizacion> {
  const pubs = (await ctx.store.publicaciones(ctx.projectId)).filter((p) => p.estado === "activa");
  const pares = new Map<string, ReturnType<typeof ladosPara>>();
  const ladosDe = (p: Publicacion) => {
    const clave = `${p.origenProyecto}>${p.destinoProyecto}`;
    if (!pares.has(clave)) pares.set(clave, ladosPara(ctx, p.origenProyecto, p.destinoProyecto));
    return pares.get(clave)!;
  };
  const resultado: PlanSincronizacion = { tareas: [], avisos: [], diferencias: 0, revisadas: 0 };
  for (const p0 of pubs) {
    let p = p0;
    const etiqueta = `“${p.nombre}” (${p.origenNombre} → ${p.destinoNombre})`;
    const lados = await ladosDe(p);
    if ("aviso" in lados) {
      resultado.avisos.push(`${etiqueta}: ${lados.aviso}.`);
      continue;
    }
    const { o, d } = lados;
    if (!p.destinoCarpetaId) {
      const r = await ctx.store.recepcion(p.destinoProyecto, p.origenProyecto);
      if (!r?.activa) {
        resultado.avisos.push(`${etiqueta}: espera que un administrador de ${p.destinoNombre} defina la carpeta de recepción para ${p.origenNombre}.`);
        continue;
      }
      let carpetaId: string | null = r.carpetaId;
      let carpetaRuta = r.carpetaRuta;
      if (p.tipo === "carpeta") {
        carpetaId = await asegurarCarpeta(d.cliente, r.carpetaId, p.nombre);
        carpetaRuta = `${r.carpetaRuta} / ${p.nombre}`;
      }
      if (!carpetaId) {
        resultado.avisos.push(`${etiqueta}: no se pudo crear la carpeta “${p.nombre}” en la carpeta de recepción (revisa tu permiso ahí).`);
        continue;
      }
      p = await ctx.store.actualizarPublicacion(p.id, { destinoCarpetaId: carpetaId, destinoCarpetaRuta: carpetaRuta });
    }
    const ahora = await contenidoEnOrigen(o.cliente, p);
    const seguidos = await ctx.store.archivos([p.id]);
    if (!ahora) {
      await ctx.store.actualizarPublicacion(p.id, { estado: "retirada", revisado: iso(ctx) });
      for (const s of seguidos) if (s.estado !== "retirado") await ctx.store.actualizarArchivo(s.id, { estado: "retirado", mensaje: "Ya no está en el origen.", actualizado: iso(ctx) });
      await registrar(ctx, { ...p, publicacionId: p.id }, "retirado", { nombre: p.nombre, nota: "Ya no está en el origen: en el destino queda como estaba y deja de actualizarse.", resultado: "aviso" });
      resultado.avisos.push(`${etiqueta}: ya no está en el origen; en el destino queda como estaba.`);
      continue;
    }
    if (!ahora.completo) resultado.avisos.push(`${etiqueta}: tiene más de ${LIMITE_ARCHIVOS} archivos; solo se siguen los primeros ${LIMITE_ARCHIVOS}.`);
    for (const f of ahora.archivos) {
      const s = seguidos.find((x) => x.origenFileId === f.fileId);
      const tarea = (a: ArchivoSeguido, motivo: Tarea["motivo"]) => resultado.tareas.push({ archivoId: a.id, publicacionId: p.id, nombre: a.nombre, subcarpeta: a.subcarpeta, motivo });
      if (!s) {
        const nuevo = await ctx.store.crearArchivo({
          publicacionId: p.id,
          origenFileId: f.fileId,
          nombre: f.nombre,
          subcarpeta: f.subcarpeta,
          origenVersionId: null,
          origenRevision: null,
          destinoFileId: null,
          destinoVersionId: null,
          destinoRevision: null,
          estado: "pendiente",
          mensaje: "",
          enCursoHasta: null,
          copiandoUploadId: null,
          copiandoVersionId: null,
          copiandoRevision: null,
          diferenciaVersionId: null,
          actualizado: iso(ctx),
        });
        tarea(nuevo, "nuevo");
        continue;
      }
      if (s.estado === "diferencia") {
        resultado.diferencias++;
        continue;
      }
      const cambio = s.origenVersionId !== f.versionId;
      if (cambio || s.estado !== "al-dia") {
        const a = s.estado === "pendiente" && s.nombre === f.nombre && s.subcarpeta === f.subcarpeta ? s : await ctx.store.actualizarArchivo(s.id, { estado: "pendiente", nombre: f.nombre, subcarpeta: f.subcarpeta, actualizado: iso(ctx) });
        tarea(a, s.origenVersionId ? "version" : "nuevo");
      }
    }
    for (const s of seguidos) {
      if (s.estado === "retirado" || ahora.archivos.some((f) => f.fileId === s.origenFileId)) continue;
      if (!ahora.completo) continue;
      await ctx.store.actualizarArchivo(s.id, { estado: "retirado", mensaje: "Ya no está en el origen.", actualizado: iso(ctx) });
      await registrar(ctx, { ...p, publicacionId: p.id }, "retirado", { nombre: nombreCompleto(s), nota: "Ya no está en el origen: en el destino queda como estaba y deja de actualizarse.", resultado: "aviso" });
    }
    await ctx.store.actualizarPublicacion(p.id, { revisado: iso(ctx) });
    resultado.revisadas++;
  }
  return resultado;
}

async function contexto(ctx: Ctx, archivoId: string) {
  const s = await ctx.store.archivo(archivoId);
  if (!s) throw new PublicarError("No se encontró el archivo.", 404);
  const p = await publicacionDeAqui(ctx, s.publicacionId);
  const lados = await ladosPara(ctx, p.origenProyecto, p.destinoProyecto);
  if ("aviso" in lados) throw new PublicarError(`No se puede copiar: ${lados.aviso}.`, 403, "sin-acceso");
  return { s, p, ...lados };
}

/** Records a finished copy and frees the file. */
async function terminar(
  ctx: Ctx,
  s: ArchivoSeguido,
  p: Publicacion,
  origen: { versionId: string | null; revision: number | null },
  destino: { fileId: string | null; versionId: string | null; revision: number | null },
  conectada: string | null
) {
  const accion: AccionActividad = s.estado === "diferencia" ? "reemplazar" : s.origenVersionId ? "actualizar" : "copiar";
  await ctx.store.actualizarArchivo(s.id, {
    estado: "al-dia",
    mensaje: "",
    origenVersionId: origen.versionId,
    origenRevision: origen.revision,
    destinoFileId: destino.fileId,
    destinoVersionId: destino.versionId,
    destinoRevision: destino.revision,
    enCursoHasta: null,
    copiandoUploadId: null,
    copiandoVersionId: null,
    copiandoRevision: null,
    diferenciaVersionId: null,
    actualizado: iso(ctx),
  });
  const nota = {
    copiar: "Primera copia en el destino.",
    actualizar: `Actualización automática – versión ${origen.revision ?? "?"} del origen.`,
    reemplazar: "Reemplazó lo que había en el destino, con la confirmación de quien lo revisó.",
  }[accion as "copiar" | "actualizar" | "reemplazar"];
  await registrar(ctx, { ...p, publicacionId: p.id }, accion, { nombre: nombreCompleto(s), versionOrigen: origen.revision, versionDestino: destino.revision, nota: conectada ? `${nota} Copiado con la cuenta conectada (${conectada}).` : nota });
}

/**
 * Copies the latest version of one followed file. If the destination has a
 * file of that name that isn't the last copy made (someone changed it), it
 * becomes a "diferencia" unless it's the same content; `siVersion` replaces
 * it, only if it's still the version the person saw.
 */
async function copiarArchivo(ctx: Ctx, archivoId: string, siVersion: string | null): Promise<PasoArchivo> {
  const { s, p, o, d, conectada } = await contexto(ctx, archivoId);
  if (p.estado !== "activa") return { ok: false, mensaje: "Esa publicación no está activa." };
  if (!p.destinoCarpetaId) return { ok: false, mensaje: "La publicación aún no tiene carpeta en el destino." };
  if (siVersion && s.estado !== "diferencia") return { ok: false, mensaje: "Ese archivo no tiene una diferencia por decidir." };
  if (!(await ctx.store.tomarArchivo(s.id, iso(ctx, MINUTOS_COPIA), iso(ctx)))) return { ok: false, ocupado: true, mensaje: "Otra persona lo está copiando en este momento." };
  const soltar = (cambios: Partial<ArchivoSeguido>) => ctx.store.actualizarArchivo(s.id, { ...cambios, enCursoHasta: null, actualizado: iso(ctx) });
  try {
    const { archivo: a, respuesta } = await leerArchivo(o.cliente, s.origenFileId);
    if (!a) {
      if (respuesta.estado !== 404) {
        await soltar({ estado: "error", mensaje: `No se pudo leer en el origen: ${explicarEstado(respuesta.estado)}` });
        return { ok: false, mensaje: `No se pudo leer “${s.nombre}” en el origen: ${explicarEstado(respuesta.estado)}` };
      }
      await soltar({ estado: "retirado", mensaje: "Ya no está en el origen." });
      await registrar(ctx, { ...p, publicacionId: p.id }, "retirado", { nombre: nombreCompleto(s), nota: "Ya no está en el origen: en el destino queda como estaba.", resultado: "aviso" });
      return { ok: false, mensaje: `“${s.nombre}” ya no está en el origen.` };
    }
    const carpetaId = s.subcarpeta ? await asegurarRuta(d.cliente, p.destinoCarpetaId, s.subcarpeta) : p.destinoCarpetaId;
    if (!carpetaId) {
      await soltar({ estado: "error", mensaje: `No se pudo crear la subcarpeta “${s.subcarpeta}” en el destino.` });
      return { ok: false, mensaje: `No se pudo crear la subcarpeta “${s.subcarpeta}” en el destino.` };
    }
    const hallado = await buscarEnCarpeta(d.cliente, carpetaId, a.nombre, "FILE");
    const b: ArchivoTrimble | null = hallado ? (await leerArchivo(d.cliente, hallado.id)).archivo : null;

    if (siVersion) {
      if (!b || b.versionId !== siVersion) {
        await soltar({});
        return { ok: false, diferencia: true, mensaje: "El archivo cambió en el destino después de revisarlo: míralo otra vez antes de reemplazarlo." };
      }
    } else if (b) {
      const esLaNuestra = !!s.destinoVersionId && b.versionId === s.destinoVersionId;
      if (situacionDe(a, b) === "al-dia") {
        // Same content already there (ours or not): just remember it.
        await terminar(ctx, s, p, a, { fileId: b.id, versionId: b.versionId, revision: b.revision }, conectada);
        return { ok: true, listo: true, mensaje: `“${s.nombre}” ya estaba igual en el destino.` };
      }
      if (!esLaNuestra) {
        const quien = [b.modificadoPor, b.modificado ? fechaHora(b.modificado) : ""].filter(Boolean).join(", ");
        const mensaje = `En el destino hay otra versión de “${a.nombre}” (versión ${b.revision ?? "?"}${quien ? `, ${quien}` : ""}) distinta de la que se copió. No se reemplaza sin confirmación.`;
        await soltar({ estado: "diferencia", mensaje, diferenciaVersionId: b.versionId });
        await registrar(ctx, { ...p, publicacionId: p.id }, "diferencia", { nombre: nombreCompleto(s), versionOrigen: a.revision, versionDestino: b.revision, nota: mensaje, resultado: "aviso" });
        return { ok: false, diferencia: true, mensaje };
      }
    }

    const base = { origen: o, destino: d, archivo: a, carpetaId, enDestino: b ? { versionId: b.versionId } : null, fetch: ctx.deps.fetch };
    let r = await copiarUltimaVersion(base);
    if (!r.ok && r.reintentarSinModelo) r = await copiarUltimaVersion({ ...base, sinModelo: true });
    if (!r.ok) {
      if (r.http === 412) {
        await soltar({ estado: "diferencia", mensaje: "El archivo cambió en el destino mientras se copiaba. No se reemplazó." });
        return { ok: false, diferencia: true, mensaje: "El archivo cambió en el destino mientras se copiaba. No se reemplazó." };
      }
      await soltar({ estado: "error", mensaje: r.mensaje });
      await registrar(ctx, { ...p, publicacionId: p.id }, "error", { nombre: nombreCompleto(s), versionOrigen: a.revision, nota: r.mensaje, resultado: "error" });
      return { ok: false, mensaje: r.mensaje };
    }
    if (r.metodo === "trimble") {
      await terminar(ctx, s, p, a, { fileId: r.fileId ?? null, versionId: r.versionId ?? null, revision: r.revision ?? null }, conectada);
      return { ok: true, listo: true, mensaje: r.mensaje };
    }
    await ctx.store.actualizarArchivo(s.id, { copiandoUploadId: r.uploadId ?? null, copiandoVersionId: a.versionId, copiandoRevision: a.revision, enCursoHasta: iso(ctx, MINUTOS_SUBIDA), actualizado: iso(ctx) });
    return { ok: true, listo: false, uploadId: r.uploadId, mensaje: r.mensaje };
  } catch (err) {
    await soltar({ estado: "error", mensaje: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    throw err;
  }
}

/** Checks with Trimble an upload started by "copiar" and records it when it's done. */
async function confirmar(ctx: Ctx, archivoId: string): Promise<PasoArchivo> {
  const { s, p, d, conectada } = await contexto(ctx, archivoId);
  if (!s.copiandoUploadId) return { ok: s.estado === "al-dia", listo: true, mensaje: s.estado === "al-dia" ? "Ya está al día." : "No hay una copia en curso." };
  const e = await estadoSubida(d.cliente, s.copiandoUploadId);
  if (e.status === "DONE") {
    await terminar(ctx, s, p, { versionId: s.copiandoVersionId, revision: s.copiandoRevision }, { fileId: e.fileId, versionId: e.versionId, revision: e.revision }, conectada);
    return { ok: true, listo: true, mensaje: `Trimble confirmó la carga: versión ${e.revision ?? "?"} en el destino.` };
  }
  if (e.status === "ERROR" || e.status === "EXPIRED" || e.respuesta.estado === 404) {
    const mensaje = `Trimble no completó la carga (${e.errorReason ?? e.status ?? explicarEstado(e.respuesta.estado)}).`;
    await ctx.store.actualizarArchivo(s.id, { estado: "error", mensaje, enCursoHasta: null, copiandoUploadId: null, actualizado: iso(ctx) });
    await registrar(ctx, { ...p, publicacionId: p.id }, "error", { nombre: nombreCompleto(s), versionOrigen: s.copiandoRevision, nota: mensaje, resultado: "error" });
    return { ok: false, mensaje };
  }
  return { ok: true, listo: false, uploadId: s.copiandoUploadId, mensaje: "Trimble aún no confirma la carga." };
}

// ---------------------------------------------------------------- the connected account in this project

/**
 * What the connected account can do in this project: be a member, write in
 * each reception folder (as destination) and read what is published (as
 * origin). So each administrator sees what permission is missing.
 */
export async function revisarAcceso(ctx: Ctx): Promise<{ comprobaciones: Comprobacion[] }> {
  const t = ctx.deps.tecnico;
  const lista: Comprobacion[] = [];
  let cuenta: { email: string } | null = null;
  try {
    cuenta = t ? await t.cuenta() : null;
  } catch (err) {
    return { comprobaciones: [{ que: "Cuenta conectada", ok: false, mensaje: err instanceof Error ? err.message : String(err) }] };
  }
  if (!t || !cuenta) return { comprobaciones: [{ que: "Cuenta conectada", ok: false, mensaje: "Todavía no hay una cuenta conectada." }] };
  lista.push({ que: "Cuenta conectada", ok: true, mensaje: `${cuenta.email}.` });
  let aqui: Lado;
  try {
    aqui = await t.abrir(ctx.projectId);
  } catch {
    lista.push({ que: "Miembro de este proyecto", ok: false, mensaje: `Invita a ${cuenta.email} a este proyecto en Trimble Connect (Equipo).` });
    return { comprobaciones: lista };
  }
  lista.push({ que: "Miembro de este proyecto", ok: true, mensaje: `${cuenta.email} es miembro de este proyecto.` });
  for (const r of (await ctx.store.recepciones(ctx.projectId)).filter((x) => x.activa)) {
    const { carpeta } = await leerCarpeta(aqui.cliente, r.carpetaId);
    const escribe = carpeta?.permiso === "FULL_ACCESS";
    lista.push({
      que: `Recepción de ${r.origenNombre || r.origenProyecto}`,
      ok: escribe,
      mensaje: !carpeta ? `No ve «${r.carpetaRuta}»: dale acceso a esa carpeta.` : escribe ? `Puede subir archivos en «${r.carpetaRuta}».` : `Solo puede leer «${r.carpetaRuta}»: dale acceso completo para que pueda subir.`,
    });
  }
  for (const p of (await ctx.store.publicaciones(ctx.projectId)).filter((x) => x.origenProyecto === ctx.projectId && x.estado === "activa")) {
    const ve = p.tipo === "archivo" ? !!(await leerArchivo(aqui.cliente, p.itemId)).archivo : !!(await leerCarpeta(aqui.cliente, p.itemId)).carpeta;
    lista.push({ que: `Publicado: ${p.nombre}`, ok: ve, mensaje: ve ? "La cuenta conectada lo puede leer." : `No lo ve: dale acceso de lectura a «${p.ruta}».` });
  }
  return { comprobaciones: lista };
}

// ---------------------------------------------------------------- activity

/** "2026-10-28" (a day in Colombia) -> the moment it starts. */
function inicioDelDia(dia: string): string {
  return new Date(`${dia}T00:00:00-05:00`).toISOString();
}

/** ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (both days included): the activity of this project, newest first. */
export async function getActividad(ctx: Ctx, q: { desde?: string | null; hasta?: string | null }) {
  const dia = (v: string | null | undefined) => {
    if (!v) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new PublicarError("La fecha no es válida.");
    return v;
  };
  const desde = dia(q.desde);
  const hasta = dia(q.hasta);
  const finDelDia = hasta ? new Date(new Date(inicioDelDia(hasta)).getTime() + 86_400_000).toISOString() : undefined;
  return { entradas: await ctx.store.actividad(ctx.projectId, { desde: desde ? inicioDelDia(desde) : undefined, hasta: finDelDia, limite: 1000 }) };
}
