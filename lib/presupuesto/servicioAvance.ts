// Progress control (valor ganado): baselines (the approved schedule, frozen),
// progress reports (cortes) with each partida's cumulative % and actual cost,
// and the elements marked as built in the 3D viewer. Members read; the
// budget's editors write.
import { isIfcGuid } from "../propiedades/ifcGuid";
import { ServiceError } from "../propiedades/service";
import { esFechaIso, sumarDias } from "./calendario";
import { Ctx, requireEdit } from "./service";
import {
  AvanceResponse,
  ControlAvance,
  EjecucionItem,
  LineaBase,
  LineaBaseResumen,
  MarcaEjecucion,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_LINEAS_BASE,
} from "./types";
import { UUID_RE, validarAvance, validarLineaBase } from "./validate";

const MAX_AVANCE_BYTES = 3_500_000;
const MAX_LINEA_BASE_BYTES = 3_500_000;
const ITEM_ID = /^[A-Za-z0-9-]{1,64}$/;

function bad(message: string): never {
  throw new ServiceError(message, 400);
}

/** The progress reports, the baselines, and the one in force with its rows. */
export async function getAvance(ctx: Ctx): Promise<AvanceResponse> {
  const [stored, lineasBase] = await Promise.all([ctx.store.getAvance(ctx.projectId), ctx.store.listarLineasBase(ctx.projectId)]);
  const vigente = lineasBase.find((l) => l.vigente);
  const lineaBase = vigente ? await ctx.store.getLineaBase(ctx.projectId, vigente.id) : null;
  return {
    avance: stored ? (stored.data as ControlAvance) : null,
    version: stored?.version ?? 0,
    updatedAt: stored?.updatedAt ?? null,
    updatedBy: stored?.updatedBy ?? null,
    lineasBase,
    lineaBase,
  };
}

/** { avance, version }: saves the progress reports if nobody saved them meanwhile. */
export async function guardarAvance(ctx: Ctx, body: unknown): Promise<{ version: number }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { avance?: unknown; version?: unknown };
  if (!Number.isInteger(o.version) || (o.version as number) < 0) bad("Falta la versión del avance.");
  const avance = validarAvance(o.avance);
  if (JSON.stringify(avance).length > MAX_AVANCE_BYTES) bad("El avance es demasiado grande para guardarlo de una vez.");
  const result = await ctx.store.saveAvance(ctx.projectId, avance, o.version as number, ctx.caller.name);
  if (result === "conflict") {
    throw new ServiceError(
      "Otra persona guardó el avance mientras lo editabas. Tus cambios siguen en pantalla: recarga para ver los suyos y vuelve a aplicarlos.",
      409,
      "version-conflict"
    );
  }
  return { version: result };
}

/** One of the project's baselines, with its rows. */
export async function getLineaBase(ctx: Ctx, id: unknown): Promise<{ lineaBase: LineaBase }> {
  if (typeof id !== "string" || !UUID_RE.test(id)) bad("Línea base no válida.");
  const l = await ctx.store.getLineaBase(ctx.projectId, id);
  if (!l) throw new ServiceError("Esa línea base no existe en este proyecto.", 404);
  return { lineaBase: l };
}

/** { nombre, datos }: saves the schedule on screen as a new baseline, which becomes the one in force. */
export async function crearLineaBase(ctx: Ctx, body: unknown): Promise<{ lineaBase: LineaBaseResumen }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { nombre?: unknown; datos?: unknown };
  if (typeof o.nombre !== "string" || !o.nombre.trim()) bad("Ponle un nombre a la línea base.");
  const nombre = o.nombre.trim();
  if (nombre.length > 120) bad("Nombre de la línea base: máximo 120 caracteres.");
  const datos = validarLineaBase(o.datos);
  if (JSON.stringify(datos).length > MAX_LINEA_BASE_BYTES) bad("La línea base es demasiado grande para guardarla.");
  const existentes = await ctx.store.listarLineasBase(ctx.projectId);
  if (existentes.length >= MAX_LINEAS_BASE) bad(`Este proyecto ya tiene ${MAX_LINEAS_BASE} líneas base, el máximo.`);
  const linea = {
    id: globalThis.crypto.randomUUID(),
    nombre,
    inicio: datos.inicio,
    fin: datos.fin,
    total: datos.total,
    partidas: datos.tareas.filter((t) => t.tipo === "partida").length,
    datos,
  };
  await ctx.store.crearLineaBase(ctx.projectId, linea, ctx.caller.name);
  const guardada = (await ctx.store.listarLineasBase(ctx.projectId)).find((l) => l.id === linea.id);
  if (!guardada) throw new ServiceError("No se pudo guardar la línea base. Intenta de nuevo.", 500);
  return { lineaBase: guardada };
}

/** { id }: makes another baseline the one progress is measured against. */
export async function usarLineaBase(ctx: Ctx, body: unknown): Promise<{ lineasBase: LineaBaseResumen[] }> {
  await requireEdit(ctx);
  const idPedido = (body as { id?: unknown } | null)?.id;
  if (typeof idPedido !== "string" || !UUID_RE.test(idPedido)) bad("Línea base no válida.");
  if (!(await ctx.store.usarLineaBase(ctx.projectId, idPedido))) throw new ServiceError("Esa línea base no existe en este proyecto.", 404);
  return { lineasBase: await ctx.store.listarLineasBase(ctx.projectId) };
}

/** By partida: its elements and those built by a date (YYYY-MM-DD; today if not given). */
export async function resumenEjecucion(ctx: Ctx, hasta: unknown): Promise<{ hasta: string; items: EjecucionItem[] }> {
  const fecha = hasta === null || hasta === undefined || hasta === "" ? new Date().toISOString().slice(0, 10) : hasta;
  if (!esFechaIso(fecha)) bad("Fecha no válida.");
  return { hasta: fecha, items: await ctx.store.resumenEjecucion(ctx.projectId, fecha) };
}

/**
 * { marcas: [{ itemId, ifcGuid }], fecha }: marks those elements as built on that
 * day for those partidas (fecha null: not built). Not in the future.
 */
export async function marcarEjecutados(ctx: Ctx, body: unknown): Promise<{ marcados: number }> {
  await requireEdit(ctx);
  const o = (body ?? {}) as { marcas?: unknown; fecha?: unknown };
  const fecha = o.fecha === null ? null : o.fecha;
  if (fecha !== null && !esFechaIso(fecha)) bad("Fecha de ejecución no válida.");
  // One day of margin: the person's day may already have started where they are.
  if (fecha !== null && fecha > sumarDias(new Date().toISOString().slice(0, 10), 1)) bad("La fecha de ejecución no puede ser posterior a hoy.");
  if (!Array.isArray(o.marcas) || o.marcas.length === 0) bad("No hay elementos para marcar.");
  if (o.marcas.length > MAX_ELEMENTS_PER_REQUEST) bad(`Máximo ${MAX_ELEMENTS_PER_REQUEST} elementos por envío.`);
  const vistos = new Set<string>();
  const marcas: MarcaEjecucion[] = [];
  for (const v of o.marcas) {
    const m = (v ?? {}) as { itemId?: unknown; ifcGuid?: unknown };
    if (typeof m.itemId !== "string" || !ITEM_ID.test(m.itemId)) bad("Partida no válida.");
    if (typeof m.ifcGuid !== "string" || !isIfcGuid(m.ifcGuid)) bad("Elemento sin IFCGUID válido.");
    const k = `${m.itemId}|${m.ifcGuid}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    marcas.push({ itemId: m.itemId, ifcGuid: m.ifcGuid });
  }
  return { marcados: await ctx.store.marcarEjecutados(ctx.projectId, marcas, fecha as string | null, ctx.caller.name) };
}

/** Every linked element with the day it was built, to color the model. */
export async function elementosEjecucion(ctx: Ctx): Promise<{ elementos: { itemId: string; ifcGuid: string; modelId: string; ejecutado: string | null }[] }> {
  return { elementos: await ctx.store.elementosEjecucion(ctx.projectId) };
}
