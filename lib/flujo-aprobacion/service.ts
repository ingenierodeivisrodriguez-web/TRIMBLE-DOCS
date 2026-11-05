/**
 * "Flujo de aprobación", phase 1: the configuration. Project administrators
 * (Trimble's) create flows with their title or milestone, review folders,
 * destination and steps, and say who does what on folders or files; anyone
 * in the project sees it. Folder paths, ancestors, names of people and groups
 * always come from Trimble, never from the browser. Nothing is deleted: flows
 * and assignments are deactivated, and every change goes to the history.
 */
import type { Caller } from "../propiedades/service";
import type { FolderPermissions, ProjectGroup, ProjectUser, RawFolderItem } from "../trimbleApi";
import type { Limites } from "./recorrido";
import { esIdTrimble, FlujoError } from "./errores";
import {
  asignacionesAfectadas,
  cambiosFlujo,
  claveHito,
  conflictos,
  dentroDe,
  describirPasos,
  idsDePasos,
  limpiarTexto,
  nombrePapel,
  PAPEL_CONSULTA,
  PAPEL_REALIZA,
  revisarDatos,
} from "./flujos";
import { aclEfectiva, Acl, Equipo as EquipoPermisos, gruposQueImportan, revisarPermisos } from "./permisos";
import { nombrePersona } from "./prueba";
import { HITO_REPETIDO, FlujoStore } from "./store";
import type { Asignacion, AvisoPermisos, CarpetaFlujo, Equipo, EstadoFlujos, EntradaHistorial, Flujo, PermisosCarpeta } from "./types";

/** A folder or file of this project as Trimble has it: its path in words and the folder ids above it. */
export type ElementoTrimble = CarpetaFlujo;

/** Trimble Connect through the caller's token. */
export interface TrimbleFlujo {
  /** A folder of this project; throws when the caller can't see it or it is of another project. */
  carpeta(id: string): Promise<ElementoTrimble>;
  archivo(id: string): Promise<ElementoTrimble>;
  personas(): Promise<ProjectUser[]>;
  grupos(): Promise<ProjectGroup[]>;
  miembros(groupId: string): Promise<ProjectUser[]>;
  permisos(folderId: string): Promise<FolderPermissions>;
  /** A folder's files and subfolders (phase 2). */
  items(folderId: string): Promise<RawFolderItem[]>;
}

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: FlujoStore;
  tc: TrimbleFlujo;
  ahora?: () => Date;
  /** For the folder walk's time budget (tests). */
  reloj?: () => number;
  limites?: Limites;
}

/** Targets of one "who does what" request. */
export const MAX_OBJETIVOS = 50;
/** Groups whose members are read to check permissions. */
const MAX_GRUPOS_PERMISOS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (ctx: Ctx) => (ctx.ahora?.() ?? new Date()).toISOString();
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function exigirAdmin(ctx: Ctx) {
  if (!ctx.caller.isAdmin) throw new FlujoError("Solo los administradores del proyecto en Trimble pueden cambiar los flujos.", 403, "solo-admin");
}

function idTrimble(v: unknown, que: string): string {
  if (!esIdTrimble(v)) throw new FlujoError(`Falta ${que} o no es válida.`);
  return v;
}

function idFlujo(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new FlujoError("El flujo no es válido.");
  return v;
}

const conVersion = "Otra persona cambió este flujo mientras lo editabas: recarga para ver sus cambios. Lo que escribiste sigue en pantalla.";

async function registrar(ctx: Ctx, flujoId: string | null, accion: string, detalle: string) {
  await ctx.store.registrar({ proyecto: ctx.projectId, flujoId, accion, usuario: ctx.caller.name, usuarioId: ctx.caller.id, detalle });
}

/** Every flow of the project with its active assignments, and whether the caller administers them. */
export async function estado(ctx: Ctx): Promise<EstadoFlujos> {
  const [flujos, asignaciones] = await Promise.all([ctx.store.flujos(ctx.projectId), ctx.store.asignaciones(ctx.projectId)]);
  return {
    esAdmin: ctx.caller.isAdmin,
    yo: ctx.caller.id,
    flujos: flujos.map((f) => ({ ...f, asignaciones: asignaciones.filter((a) => a.flujoId === f.id && a.activa) })),
  };
}

/**
 * { id?, version?, hito, carpetas: [folderIds], destino, pasos: [{ id?, nombre }], confirmar? }:
 * creates or changes a flow. A change that leaves assignments without sense
 * (a removed step or folder) is refused with code "confirmar-asignaciones"
 * until it comes with `confirmar: true`; then they are deactivated.
 */
export async function guardarFlujo(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  exigirAdmin(ctx);
  const o = obj(body);
  const flujoId = o.id === undefined || o.id === null || o.id === "" ? null : idFlujo(o.id);
  const hito = typeof o.hito === "string" ? o.hito.slice(0, 300) : "";
  if (!Array.isArray(o.carpetas) || !o.carpetas.every(esIdTrimble)) throw new FlujoError("Las carpetas de revisión no son válidas.");
  const carpetasIds = [...new Set(o.carpetas as string[])];
  const destinoId = o.destino === undefined || o.destino === "" ? "" : idTrimble(o.destino, "la carpeta destino");
  if (!Array.isArray(o.pasos)) throw new FlujoError("Los pasos no son válidos.");
  const pasosIn = (o.pasos as unknown[]).map((p) => {
    const x = obj(p);
    return { id: typeof x.id === "string" && /^p\d{1,4}$/.test(x.id) ? x.id : undefined, nombre: typeof x.nombre === "string" ? x.nombre.slice(0, 200) : "" };
  });
  const error = revisarDatos({ hito, carpetas: carpetasIds, destino: destinoId, pasos: pasosIn });
  if (error) throw new FlujoError(error);

  const todos = await ctx.store.flujos(ctx.projectId);
  const antes = flujoId ? todos.find((f) => f.id === flujoId) : undefined;
  if (flujoId && !antes) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  if (antes && o.version !== antes.version) throw new FlujoError(conVersion, 409, "version-conflict");
  const hitoLimpio = limpiarTexto(hito);
  const clave = claveHito(hitoLimpio);
  if (todos.some((f) => f.id !== flujoId && f.hitoClave === clave)) throw new FlujoError(HITO_REPETIDO, 409, "hito-repetido");

  // Paths and ancestors from Trimble.
  const [carpetas, destino] = await Promise.all([Promise.all(carpetasIds.map((id) => ctx.tc.carpeta(id))), ctx.tc.carpeta(destinoId)]);
  const pasos = idsDePasos(pasosIn, antes?.pasos ?? []);
  if (antes?.activo ?? true) {
    const malos = conflictos({ id: flujoId ?? undefined, carpetas, destino }, todos);
    if (malos.length) throw new FlujoError(malos.join(" "), 409, "conflicto");
  }

  const momento = iso(ctx);
  if (!antes) {
    const creado = await ctx.store.crearFlujo({
      proyecto: ctx.projectId,
      hito: hitoLimpio,
      hitoClave: clave,
      pasos,
      carpetas,
      destino,
      activo: true,
      creado: momento,
      creadoPor: ctx.caller.name,
      actualizado: momento,
      actualizadoPor: ctx.caller.name,
    });
    await registrar(ctx, creado.id, "flujo-creado", `«${creado.hito}»: ${describirPasos(pasos)}. Revisión: ${carpetas.map((c) => c.ruta).join("; ")}. Destino: ${destino.ruta}.`);
    return estado(ctx);
  }

  const propias = (await ctx.store.asignaciones(ctx.projectId)).filter((a) => a.flujoId === antes.id);
  const afectadas = asignacionesAfectadas(propias, pasos, carpetas);
  if (afectadas.length && o.confirmar !== true) {
    const ejemplos = afectadas.slice(0, 4).map((a) => `${a.quienNombre} (${nombrePapel(a.papel, antes.pasos)} en ${a.objetivoRuta})`);
    throw new FlujoError(
      `Con este cambio ${afectadas.length === 1 ? "queda sin uso 1 asignación" : `quedan sin uso ${afectadas.length} asignaciones`}: ${ejemplos.join("; ")}${afectadas.length > 4 ? "…" : ""}. Se desactivan (no se borran). ¿Guardar igual?`,
      409,
      "confirmar-asignaciones"
    );
  }
  const guardado = await ctx.store.actualizarFlujo(antes.id, antes.version, { hito: hitoLimpio, hitoClave: clave, pasos, carpetas, destino, actualizado: momento, actualizadoPor: ctx.caller.name });
  if (!guardado) throw new FlujoError(conVersion, 409, "version-conflict");
  if (afectadas.length) await ctx.store.desactivarAsignaciones(afectadas.map((a) => a.id));
  await registrar(ctx, antes.id, "flujo-modificado", `${cambiosFlujo(antes, guardado)}${afectadas.length ? ` Asignaciones desactivadas: ${afectadas.length}.` : ""}`);
  return estado(ctx);
}

/** { id, version, activo }: deactivates a flow (kept with its history) or activates it again, if no other flow took its folders. */
export async function cambiarEstado(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  exigirAdmin(ctx);
  const o = obj(body);
  const id = idFlujo(o.id);
  if (typeof o.activo !== "boolean") throw new FlujoError("Falta si el flujo queda activo.");
  const todos = await ctx.store.flujos(ctx.projectId);
  const f = todos.find((x) => x.id === id);
  if (!f) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  if (o.version !== f.version) throw new FlujoError(conVersion, 409, "version-conflict");
  if (f.activo === o.activo) return estado(ctx);
  if (o.activo) {
    const malos = conflictos(f, todos);
    if (malos.length) throw new FlujoError(`No se puede activar: ${malos.join(" ")}`, 409, "conflicto");
  }
  const guardado = await ctx.store.actualizarFlujo(f.id, f.version, { activo: o.activo, actualizado: iso(ctx), actualizadoPor: ctx.caller.name });
  if (!guardado) throw new FlujoError(conVersion, 409, "version-conflict");
  await registrar(
    ctx,
    f.id,
    o.activo ? "flujo-activado" : "flujo-desactivado",
    o.activo ? `«${f.hito}» vuelve a revisar sus carpetas.` : `«${f.hito}» deja de revisar archivos nuevos; su configuración y su historial se conservan.`
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

/**
 * { flujoId, objetivos: [{ tipo: carpeta|archivo, id }], quien: { tipo: persona|grupo, id }, papel }:
 * gives a person or group a role (realiza, consulta or a step) on folders or
 * files inside the flow's review folders. What was already there is skipped.
 */
export async function agregarAsignaciones(ctx: Ctx, body: unknown): Promise<EstadoFlujos & { mensaje: string }> {
  exigirAdmin(ctx);
  const o = obj(body);
  const flujo = await ctx.store.flujo(idFlujo(o.flujoId));
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  const papel = typeof o.papel === "string" ? o.papel : "";
  if (papel !== PAPEL_REALIZA && papel !== PAPEL_CONSULTA && !flujo.pasos.some((p) => p.id === papel)) throw new FlujoError("Ese paso ya no existe en el flujo: recarga la página.");
  if (!Array.isArray(o.objetivos) || o.objetivos.length === 0) throw new FlujoError("Elige al menos una carpeta o un archivo.");
  if (o.objetivos.length > MAX_OBJETIVOS) throw new FlujoError(`Elige hasta ${MAX_OBJETIVOS} carpetas o archivos a la vez.`);
  const pedidos = (o.objetivos as unknown[]).map((x) => {
    const y = obj(x);
    if (y.tipo !== "carpeta" && y.tipo !== "archivo") throw new FlujoError("Una carpeta o un archivo no es válido.");
    return { tipo: y.tipo as "carpeta" | "archivo", id: idTrimble(y.id, "la carpeta o el archivo") };
  });
  const q = obj(o.quien);
  if (q.tipo !== "persona" && q.tipo !== "grupo") throw new FlujoError("Elige una persona o un grupo.");
  const quienId = idTrimble(q.id, "la persona o el grupo");
  const team = await equipo(ctx);
  const quien = q.tipo === "persona" ? team.personas.find((p) => p.id === quienId) : team.grupos.find((g) => g.id === quienId);
  if (!quien) throw new FlujoError(q.tipo === "persona" ? "Esa persona no está en el equipo del proyecto en Trimble." : "Ese grupo no existe en el proyecto en Trimble.");

  const objetivos = await Promise.all(pedidos.map(async (p) => ({ tipo: p.tipo, ...(p.tipo === "carpeta" ? await ctx.tc.carpeta(p.id) : await ctx.tc.archivo(p.id)) })));
  const fuera = objetivos.filter((x) => !flujo.carpetas.some((c) => dentroDe(x, c.id)));
  if (fuera.length) throw new FlujoError(`${fuera.map((x) => `«${x.ruta}»`).join(", ")} no ${fuera.length === 1 ? "está" : "están"} dentro de las carpetas de revisión de este flujo.`);

  const actuales = (await ctx.store.asignaciones(ctx.projectId)).filter((a) => a.activa && a.flujoId === flujo.id && a.papel === papel && a.quienTipo === q.tipo && a.quienId === quienId);
  const nuevos = objetivos.filter((x, i) => !actuales.some((a) => a.objetivoId === x.id) && objetivos.findIndex((y) => y.id === x.id) === i);
  const momento = iso(ctx);
  await ctx.store.crearAsignaciones(
    nuevos.map((x) => ({
      flujoId: flujo.id,
      proyecto: ctx.projectId,
      objetivoTipo: x.tipo,
      objetivoId: x.id,
      objetivoRuta: x.ruta,
      objetivoAncestros: x.ancestros,
      papel,
      quienTipo: q.tipo as "persona" | "grupo",
      quienId,
      quienNombre: quien.nombre,
      activa: true,
      creado: momento,
      creadoPor: ctx.caller.name,
    }))
  );
  const quienTexto = `${quien.nombre}${q.tipo === "grupo" ? " (grupo)" : ""}`;
  const papelTexto = nombrePapel(papel, flujo.pasos);
  if (nuevos.length) await registrar(ctx, flujo.id, "asignacion-agregada", `${quienTexto}: ${papelTexto} en ${nuevos.map((x) => x.ruta).join("; ")}.`);
  const ya = objetivos.length - nuevos.length;
  const mensaje = nuevos.length
    ? `${quienTexto} queda con «${papelTexto}» en ${nuevos.length === 1 ? "1 carpeta o archivo" : `${nuevos.length} carpetas o archivos`}${ya ? ` (${ya} ya lo tenía)` : ""}.`
    : `${quienTexto} ya tenía «${papelTexto}» ahí: no cambió nada.`;
  return { ...(await estado(ctx)), mensaje };
}

/** { id }: takes a role away (the assignment stays, inactive). */
export async function quitarAsignacion(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  exigirAdmin(ctx);
  const id = idFlujo(obj(body).id);
  const a = (await ctx.store.asignaciones(ctx.projectId)).find((x) => x.id === id);
  if (!a) throw new FlujoError("Esa asignación no existe en este proyecto.", 404);
  if (a.activa) {
    const flujo = await ctx.store.flujo(a.flujoId);
    await ctx.store.desactivarAsignaciones([a.id]);
    await registrar(ctx, a.flujoId, "asignacion-quitada", `${a.quienNombre}${a.quienTipo === "grupo" ? " (grupo)" : ""}: ya no tiene «${nombrePapel(a.papel, flujo?.pasos ?? [])}» en ${a.objetivoRuta}.`);
  }
  return estado(ctx);
}

/** The Trimble permissions of a flow's folders, with warnings (read only: nothing is changed in Trimble). */
export async function permisosFlujo(ctx: Ctx, flujoId: string): Promise<{ avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] }> {
  exigirAdmin(ctx);
  const flujo = await ctx.store.flujo(idFlujo(flujoId));
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  const asignaciones = (await ctx.store.asignaciones(ctx.projectId)).filter((a) => a.flujoId === flujo.id && a.activa);
  const avisos: AvisoPermisos[] = [];
  const leer = async (c: CarpetaFlujo): Promise<Acl> => {
    try {
      return aclEfectiva(await ctx.tc.permisos(c.id));
    } catch (err) {
      avisos.push({ tipo: "info", texto: `No se pudieron leer los permisos de «${c.ruta}» (${err instanceof Error ? err.message : String(err)}).` });
      return {};
    }
  };
  const [destino, ...deCarpetas] = await Promise.all([leer(flujo.destino), ...flujo.carpetas.map(leer)]);
  const [personas, grupos] = await Promise.all([ctx.tc.personas(), ctx.tc.grupos()]);
  const ids = gruposQueImportan([destino, ...deCarpetas], asignaciones).slice(0, MAX_GRUPOS_PERMISOS);
  const miembros = await Promise.all(ids.map(async (g) => [g, new Set((await ctx.tc.miembros(g).catch(() => [])).map((p) => p.id))] as const));
  const team: EquipoPermisos = {
    personas: new Map(personas.map((p) => [p.id, { nombre: limpiarTexto(nombrePersona(p)) || p.id, admin: p.role === "ADMIN" }])),
    grupos: new Map(grupos.map((g) => [g.id, limpiarTexto(g.name ?? "")])),
    miembros: new Map(miembros),
  };
  const r = revisarPermisos(flujo, asignaciones, { destino, carpetas: new Map(flujo.carpetas.map((c, i) => [c.id, deCarpetas[i]])) }, team);
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

export type { Asignacion, Flujo };
