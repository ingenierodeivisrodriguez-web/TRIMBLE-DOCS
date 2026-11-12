/**
 * "Flujo de aprobación": the configuration. Any member of the project creates
 * a flow with its title or milestone, the files that go through it and its
 * steps, each with its responsible; whoever created it and the project
 * administrators (Trimble's) change it; everyone in the project sees it. File
 * paths and names of people and groups always come from Trimble, never from
 * the browser. Nothing is deleted: flows are deactivated, files taken out of
 * a flow are retired, and every change goes to the history.
 */
import type { Caller } from "../propiedades/service";
import type { FolderPermissions, ProjectGroup, ProjectUser, RawFolderItem } from "../trimbleApi";
import type { Limites } from "./recorrido";
import type { Respuesta } from "../compras/cde";
import type { Lado } from "../publicar/copiar";
import type { Correo } from "./correo";
import { esIdTrimble, FlujoError } from "./errores";
import {
  cambiosFlujo,
  claveHito,
  codigoFlujo,
  conflictosArchivos,
  describirPasos,
  describirResponsables,
  diaVisible,
  idsDePasos,
  limpiarTexto,
  nombreDeRuta,
  PasoEnvio,
  primerasDecisiones,
  puedeCambiar,
  revisarDatos,
  textoCerrado,
} from "./flujos";
import { aclEfectiva, Acl, Equipo as EquipoPermisos, gruposQueImportan, revisarPermisos } from "./permisos";
import { nombrePersona } from "./prueba";
import { revisarFlujo } from "./revision";
import { armarTrazas, FiltroTraza, Traza } from "./trazabilidad";
import { HITO_REPETIDO, FlujoStore } from "./store";
import type { ArchivoFlujo, AvisoPermisos, CarpetaFlujo, Cierre, Comentario, Equipo, EstadoFlujos, EntradaHistorial, Flujo, PasoFlujo, PermisosCarpeta, Responsable } from "./types";

/** A folder or file of this project as Trimble has it: its path in words and the folder ids above it. */
export type ElementoTrimble = CarpetaFlujo;

/** Trimble Connect through the caller's token. */
export interface TrimbleFlujo {
  /** A folder of this project and the caller's access to it, as Trimble says; throws when the caller can't see it or it is of another project. */
  carpeta(id: string): Promise<ElementoTrimble & { permiso?: "READ" | "FULL_ACCESS" | null }>;
  /** A file of this project (where it is now); throws with status 404 when it doesn't exist. */
  archivo(id: string): Promise<ElementoTrimble>;
  personas(): Promise<ProjectUser[]>;
  grupos(): Promise<ProjectGroup[]>;
  miembros(groupId: string): Promise<ProjectUser[]>;
  permisos(folderId: string): Promise<FolderPermissions>;
  /** A folder's files and subfolders (phase 2). */
  items(folderId: string): Promise<RawFolderItem[]>;
  /** The id of a file's latest version in Trimble right now (phase 3). */
  version(fileId: string): Promise<string | null>;
  /** POST /todos with that body (phase 3). Answers never throw: the status says what happened. */
  crearTarea(cuerpo: Record<string, unknown>): Promise<Respuesta>;
  /** PATCH /todos/{id} with that body, to close a ToDo (10-11-2026). Answers never throw. Missing: ToDos are not closed. */
  actualizarTarea?(todoId: string, cuerpo: Record<string, unknown>): Promise<Respuesta>;
  /** This project through the caller's token, for copying to the destination (phase 4). */
  lado: Lado;
  /** The project's name in Trimble, for the e-mails (11-11-2026). Missing: "Trimble Connect". */
  nombreProyecto?(): Promise<string>;
  /** For the content of a copy that goes through the server (tests). */
  fetch?: typeof fetch;
}

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: FlujoStore;
  tc: TrimbleFlujo;
  ahora?: () => Date;
  /** The extension's own e-mails (11-11-2026); missing when Vercel has no Gmail account set: no e-mail goes. */
  correo?: Correo;
  /** For the file reading's time budget (tests). */
  reloj?: () => number;
  limites?: Limites;
}

/** Folders whose permissions are read in one check. */
const MAX_CARPETAS_PERMISOS = 20;
/** Groups whose members are read to check permissions. */
const MAX_GRUPOS_PERMISOS = 30;
/** Files read from Trimble at the same time when they are chosen. */
const PARALELO = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (ctx: Ctx) => (ctx.ahora?.() ?? new Date()).toISOString();
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Only whoever created the flow, or a project administrator, changes it. */
function exigirPermiso(ctx: Ctx, f: Flujo) {
  if (!puedeCambiar(f, { id: ctx.caller.id, esAdmin: ctx.caller.isAdmin })) {
    throw new FlujoError(`Solo quien creó este flujo${f.creadoPor ? ` (${f.creadoPor})` : ""} o un administrador del proyecto en Trimble puede cambiarlo.`, 403, "sin-permiso");
  }
}

function idFlujo(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new FlujoError("El flujo no es válido.");
  return v;
}

const conVersion = "Otra persona cambió este flujo mientras lo editabas: recarga para ver sus cambios. Lo que escribiste sigue en pantalla.";

async function registrar(ctx: Ctx, flujoId: string | null, accion: string, detalle: string) {
  await ctx.store.registrar({ proyecto: ctx.projectId, flujoId, accion, usuario: ctx.caller.name, usuarioId: ctx.caller.id, detalle });
}

async function enTandas<T, R>(xs: T[], f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += PARALELO) out.push(...(await Promise.all(xs.slice(i, i + PARALELO).map(f))));
  return out;
}

/** The flows closed by a first decision (from the history, which is never edited). */
async function cierres(ctx: Ctx): Promise<Record<string, Cierre>> {
  return primerasDecisiones(await ctx.store.decisiones(ctx.projectId));
}

/** Once a flow has a decision nobody edits, activates or deactivates it, administrators included (09-11-2026). */
async function exigirAbierto(ctx: Ctx, f: Flujo) {
  const c = (await cierres(ctx))[f.id];
  if (c) throw new FlujoError(textoCerrado(f.hito, c), 409, "flujo-cerrado");
}

/** Every flow of the project, which ones are closed, who is asking and whether they administer it. */
export async function estado(ctx: Ctx): Promise<EstadoFlujos> {
  const [flujos, cerrados] = await Promise.all([ctx.store.flujos(ctx.projectId), cierres(ctx)]);
  return { esAdmin: ctx.caller.isAdmin, yo: ctx.caller.id, flujos, cierres: cerrados };
}

/** The steps as the browser sent them (responsible: only its type and id). */
function pasosRecibidos(v: unknown): PasoEnvio[] {
  if (!Array.isArray(v)) throw new FlujoError("Los pasos no son válidos.");
  return v.map((p) => {
    const x = obj(p);
    const r = obj(x.responsable);
    const responsable = (r.tipo === "persona" || r.tipo === "grupo") && esIdTrimble(r.id) ? { tipo: r.tipo as "persona" | "grupo", id: r.id as string } : null;
    return { id: typeof x.id === "string" && /^p\d{1,4}$/.test(x.id) ? x.id : undefined, nombre: typeof x.nombre === "string" ? x.nombre.slice(0, 200) : "", responsable };
  });
}

/** Each step's responsible with the name Trimble gives (a person removed from the project or a deleted group is refused). */
function conResponsables(pasos: (PasoEnvio & { id: string; nombre: string })[], team: Equipo): PasoFlujo[] {
  return pasos.map((p) => {
    const r = p.responsable!;
    const quien = r.tipo === "persona" ? team.personas.find((x) => x.id === r.id) : team.grupos.find((x) => x.id === r.id);
    if (!quien) throw new FlujoError(`«${p.nombre}»: ${r.tipo === "persona" ? "esa persona no está en el equipo del proyecto en Trimble" : "ese grupo no existe en el proyecto en Trimble"}; elige otro responsable.`);
    const responsable: Responsable = { tipo: r.tipo, id: r.id, nombre: quien.nombre };
    return { id: p.id, nombre: p.nombre, responsable };
  });
}

/**
 * { id?, version?, hito, archivos: [fileIds], pasos: [{ id?, nombre, responsable: { tipo, id } }], vence?, notas? }:
 * creates a flow (any member of the project) or changes it (whoever created it,
 * or an administrator). Then its files are registered at once (new ones wait
 * for the first step and its responsible gets a Trimble ToDo; files taken out
 * are retired, never deleted).
 */
export async function guardarFlujo(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  const o = obj(body);
  const flujoId = o.id === undefined || o.id === null || o.id === "" ? null : idFlujo(o.id);
  const hito = typeof o.hito === "string" ? o.hito.slice(0, 300) : "";
  if (!Array.isArray(o.archivos) || !o.archivos.every(esIdTrimble)) throw new FlujoError("Los archivos del flujo no son válidos.");
  const archivosIds = [...new Set(o.archivos as string[])];
  const pasosIn = pasosRecibidos(o.pasos);
  const vence = typeof o.vence === "string" && o.vence.trim() ? o.vence.trim() : null;
  const notas = typeof o.notas === "string" ? o.notas.trim() : "";
  const error = revisarDatos({ hito, archivos: archivosIds, pasos: pasosIn, vence, notas });
  if (error) throw new FlujoError(error);

  const todos = await ctx.store.flujos(ctx.projectId);
  const antes = flujoId ? todos.find((f) => f.id === flujoId) : undefined;
  if (flujoId && !antes) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  if (antes) {
    exigirPermiso(ctx, antes);
    await exigirAbierto(ctx, antes);
  }
  if (antes && o.version !== antes.version) throw new FlujoError(conVersion, 409, "version-conflict");
  const hitoLimpio = limpiarTexto(hito);
  const clave = claveHito(hitoLimpio);
  if (todos.some((f) => f.id !== flujoId && f.hitoClave === clave)) throw new FlujoError(HITO_REPETIDO, 409, "hito-repetido");

  // Names of the responsibles and paths of the new files, from Trimble.
  const pasos = conResponsables(idsDePasos(pasosIn, antes?.pasos ?? []), await equipo(ctx));
  const previos = new Map((antes?.archivos ?? []).map((a) => [a.id, a]));
  const archivos: ArchivoFlujo[] = await enTandas(archivosIds, async (id) => previos.get(id) ?? (await ctx.tc.archivo(id)));
  if (antes?.activo ?? true) {
    const malos = conflictosArchivos({ id: flujoId ?? undefined, archivos }, todos);
    if (malos.length) throw new FlujoError(malos.join(" "), 409, "conflicto");
  }

  const momento = iso(ctx);
  let guardado: Flujo;
  if (!antes) {
    guardado = await ctx.store.crearFlujo({
      proyecto: ctx.projectId,
      hito: hitoLimpio,
      hitoClave: clave,
      pasos,
      archivos,
      carpetas: [],
      destino: null,
      activo: true,
      creado: momento,
      creadoPor: ctx.caller.name,
      creadoPorId: ctx.caller.id,
      actualizado: momento,
      actualizadoPor: ctx.caller.name,
      vence,
      notas,
    });
    const lista = archivos.map((a) => nombreDeRuta(a.ruta));
    await registrar(
      ctx,
      guardado.id,
      "flujo-creado",
      `«${guardado.hito}»: ${describirPasos(pasos)}. Responsables: ${describirResponsables(pasos)}. Archivos (${archivos.length}): ${lista.slice(0, 20).join("; ")}${lista.length > 20 ? `; y ${lista.length - 20} más` : ""}.${vence ? ` Vence el ${diaVisible(vence)}.` : ""}`
    );
  } else {
    const nuevo = await ctx.store.actualizarFlujo(antes.id, antes.version, { hito: hitoLimpio, hitoClave: clave, pasos, archivos, vence, notas, actualizado: momento, actualizadoPor: ctx.caller.name });
    if (!nuevo) throw new FlujoError(conVersion, 409, "version-conflict");
    guardado = nuevo;
    await registrar(ctx, antes.id, "flujo-modificado", cambiosFlujo(antes, guardado));
  }

  // Register its files now: whoever saved sees them waiting, and the first responsible gets the ToDo.
  let mensaje: string | undefined;
  if (guardado.activo) {
    try {
      mensaje = (await revisarFlujo(ctx, { flujoId: guardado.id })).mensaje;
    } catch (err) {
      mensaje = `El flujo quedó guardado, pero sus archivos no se pudieron registrar ahora (${err instanceof Error ? err.message : String(err)}): se registrarán con «Revisar ahora».`;
    }
  }
  return { ...(await estado(ctx)), mensaje };
}

/** { id, version, activo }: deactivates a flow (kept with its history) or activates it again, if none of its files went to another active flow. */
export async function cambiarEstado(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  const o = obj(body);
  const id = idFlujo(o.id);
  if (typeof o.activo !== "boolean") throw new FlujoError("Falta si el flujo queda activo.");
  const todos = await ctx.store.flujos(ctx.projectId);
  const f = todos.find((x) => x.id === id);
  if (!f) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  exigirPermiso(ctx, f);
  await exigirAbierto(ctx, f);
  if (o.version !== f.version) throw new FlujoError(conVersion, 409, "version-conflict");
  if (f.activo === o.activo) return estado(ctx);
  if (o.activo) {
    const malos = conflictosArchivos(f, todos);
    if (malos.length) throw new FlujoError(`No se puede activar: ${malos.join(" ")}`, 409, "conflicto");
  }
  const guardado = await ctx.store.actualizarFlujo(f.id, f.version, { activo: o.activo, actualizado: iso(ctx), actualizadoPor: ctx.caller.name });
  if (!guardado) throw new FlujoError(conVersion, 409, "version-conflict");
  await registrar(
    ctx,
    f.id,
    o.activo ? "flujo-activado" : "flujo-desactivado",
    o.activo ? `«${f.hito}» vuelve a revisar sus archivos.` : `«${f.hito}» deja de revisar versiones nuevas; su configuración y su historial se conservan.`
  );
  return estado(ctx);
}

/** The project's people (not removed) and groups, as Trimble lists them. */
export async function equipo(ctx: Ctx): Promise<Equipo> {
  const [personas, grupos] = await Promise.all([ctx.tc.personas(), ctx.tc.grupos()]);
  const porNombre = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  return {
    personas: personas
      .filter((p) => (p.status ?? "ACTIVE").toUpperCase() !== "REMOVED")
      .map((p) => ({ id: p.id, nombre: limpiarTexto(nombrePersona(p)) || p.id, email: p.email ?? "", admin: p.role === "ADMIN", pendiente: (p.status ?? "").toUpperCase() === "PENDING" }))
      .sort((a, b) => porNombre.compare(a.nombre, b.nombre)),
    grupos: grupos.map((g) => ({ id: g.id, nombre: limpiarTexto(g.name ?? "") || "(sin nombre)" })).sort((a, b) => porNombre.compare(a.nombre, b.nombre)),
  };
}

/** The folders where a flow's files are now (registered location first), without repeats. */
async function carpetasDeArchivos(ctx: Ctx, f: Flujo): Promise<CarpetaFlujo[]> {
  const registrados = new Map((await ctx.store.archivos(ctx.projectId)).filter((a) => a.flujoId === f.id && a.estado !== "retirado").map((a) => [a.fileId, a]));
  const carpetas = new Map<string, CarpetaFlujo>();
  for (const a of f.archivos) {
    const x = registrados.get(a.id) ?? { ruta: a.ruta, ancestros: a.ancestros };
    const id = x.ancestros[x.ancestros.length - 1];
    if (!id || carpetas.has(id)) continue;
    const i = x.ruta.lastIndexOf(" / ");
    carpetas.set(id, { id, ruta: i > 0 ? x.ruta.slice(0, i) : x.ruta, ancestros: x.ancestros.slice(0, -1) });
  }
  return [...carpetas.values()];
}

/** The Trimble permissions of the folders where a flow's files are, with warnings (read only: nothing is changed in Trimble). */
export async function permisosFlujo(ctx: Ctx, flujoId: string): Promise<{ avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] }> {
  const flujo = await ctx.store.flujo(idFlujo(flujoId));
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  exigirPermiso(ctx, flujo);
  const avisos: AvisoPermisos[] = [];
  const leer = async (c: CarpetaFlujo): Promise<Acl> => {
    try {
      return aclEfectiva(await ctx.tc.permisos(c.id));
    } catch (err) {
      avisos.push({ tipo: "info", texto: `No se pudieron leer los permisos de «${c.ruta}» (${err instanceof Error ? err.message : String(err)}).` });
      return {};
    }
  };
  const todas = await carpetasDeArchivos(ctx, flujo);
  if (todas.length > MAX_CARPETAS_PERMISOS) avisos.push({ tipo: "info", texto: `Los archivos están en ${todas.length} carpetas: se revisan las primeras ${MAX_CARPETAS_PERMISOS}.` });
  const carpetas = todas.slice(0, MAX_CARPETAS_PERMISOS);
  const [destino, ...deCarpetas] = await Promise.all([flujo.destino ? leer(flujo.destino) : Promise.resolve(null), ...carpetas.map(leer)]);
  const [personas, grupos] = await Promise.all([ctx.tc.personas(), ctx.tc.grupos()]);
  const responsables = flujo.pasos.map((p) => p.responsable).filter((r): r is Responsable => !!r);
  const ids = gruposQueImportan([...(destino ? [destino] : []), ...deCarpetas], responsables).slice(0, MAX_GRUPOS_PERMISOS);
  const miembros = await Promise.all(ids.map(async (g) => [g, new Set((await ctx.tc.miembros(g).catch(() => [])).map((p) => p.id))] as const));
  const team: EquipoPermisos = {
    personas: new Map(personas.map((p) => [p.id, { nombre: limpiarTexto(nombrePersona(p)) || p.id, admin: p.role === "ADMIN" }])),
    grupos: new Map(grupos.map((g) => [g.id, limpiarTexto(g.name ?? "")])),
    miembros: new Map(miembros),
  };
  const r = revisarPermisos(flujo, carpetas.map((c, i) => ({ carpeta: c, acl: deCarpetas[i] })), destino, team);
  return { avisos: [...avisos, ...r.avisos], carpetas: r.carpetas };
}

/** The history, newest first (of one flow, or of one registered file, when given). */
export async function historial(ctx: Ctx, flujoId: string | null, archivoId: string | null = null): Promise<{ entradas: EntradaHistorial[] }> {
  const entradas = await ctx.store.historial(ctx.projectId, {
    flujoId: flujoId ? idFlujo(flujoId) : undefined,
    archivoId: archivoId ? idFlujo(archivoId) : undefined,
    limite: archivoId ? 500 : 300,
  });
  // By when it happened (an upload's date is Trimble's, not when it was noted).
  const cuando = (e: EntradaHistorial) => e.ocurrido ?? e.creado;
  return { entradas: entradas.sort((a, b) => cuando(b).localeCompare(cuando(a)) || b.id - a.id) };
}

export type { Flujo };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS_ARCHIVO = ["pendiente", "nueva-version", "aprobado", "rechazado", "retirado"];

/**
 * Traceability (phase 5): the registered files that match the filter
 * (?flujoId=&estado=&desde=AAAA-MM-DD&hasta=&texto=, or ?archivoId= for one),
 * each with everything that happened to it, in order. Any project member.
 */
export async function trazabilidad(ctx: Ctx, q: { get(nombre: string): string | null }): Promise<{ trazas: Traza[]; filtro: FiltroTraza; hitos: Record<string, string>; por: string }> {
  const opcional = (k: string) => q.get(k)?.trim() || undefined;
  const flujoId = opcional("flujoId");
  const archivoId = opcional("archivoId");
  if (flujoId && !UUID.test(flujoId)) throw new FlujoError("El flujo no es válido.");
  if (archivoId && !UUID.test(archivoId)) throw new FlujoError("El archivo no es válido.");
  const estado = opcional("estado");
  if (estado && !ESTADOS_ARCHIVO.includes(estado)) throw new FlujoError("El estado no es válido.");
  const desde = opcional("desde");
  const hasta = opcional("hasta");
  if ((desde && !DIA.test(desde)) || (hasta && !DIA.test(hasta))) throw new FlujoError("Las fechas no son válidas.");
  if (desde && hasta && desde > hasta) throw new FlujoError("La fecha inicial es posterior a la final.");
  const filtro: FiltroTraza = { flujoId, estado: estado as FiltroTraza["estado"], desde, hasta, texto: opcional("texto")?.slice(0, 100) };
  const [flujos, archivos, entradas] = await Promise.all([ctx.store.flujos(ctx.projectId), ctx.store.archivos(ctx.projectId), ctx.store.historialArchivos(ctx.projectId)]);
  const hitos = new Map(flujos.map((f) => [f.id, f.codigo ? `${codigoFlujo(f.codigo)} · ${f.hito}` : f.hito]));
  const elegidos = archivoId ? archivos.filter((a) => a.id === archivoId) : archivos;
  if (archivoId && !elegidos.length) throw new FlujoError("Ese archivo no está registrado en este proyecto.", 404);
  return { trazas: armarTrazas(elegidos, entradas, hitos, filtro), filtro, hitos: Object.fromEntries(hitos), por: ctx.caller.name };
}

/** A flow's comments, oldest first (any project member). */
export async function comentarios(ctx: Ctx, flujoId: string): Promise<{ comentarios: Comentario[] }> {
  const flujo = await ctx.store.flujo(idFlujo(flujoId));
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  return { comentarios: await ctx.store.comentarios(flujo.id) };
}

/** { flujoId, texto }: adds a comment to a flow (any project member). Comments are never edited or deleted. */
export async function comentar(ctx: Ctx, body: unknown): Promise<{ comentarios: Comentario[] }> {
  const o = obj(body);
  const flujo = await ctx.store.flujo(idFlujo(o.flujoId));
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  const texto = typeof o.texto === "string" ? o.texto.trim() : "";
  if (!texto) throw new FlujoError("Escribe el comentario.");
  if (texto.length > 2000) throw new FlujoError("El comentario admite hasta 2000 caracteres.");
  await ctx.store.agregarComentario({ proyecto: ctx.projectId, flujoId: flujo.id, texto, usuario: ctx.caller.name, usuarioId: ctx.caller.id });
  return { comentarios: await ctx.store.comentarios(flujo.id) };
}
