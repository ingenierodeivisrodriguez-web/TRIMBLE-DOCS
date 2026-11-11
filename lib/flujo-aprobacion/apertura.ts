/**
 * «Abrió el archivo» in the history (the owner, 11-11-2026): when the person
 * a file's notice went to opens it from the extension (the file's name in the
 * table, or its link when deciding), the first time for each version. Trimble
 * doesn't record who opens a file in its viewer (its activity log only has
 * downloads), so an opening straight from Trimble's explorer can't be noted.
 */
import { fechaHora } from "../compras/formato";
import { FlujoError } from "./errores";
import { ESPERANDO, responsablesArchivo } from "./registro";
import type { Ctx } from "./service";
import type { ArchivoRegistro, EntradaHistorial, Flujo } from "./types";

type Linea = Omit<EntradaHistorial, "id" | "creado">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2 minutos", "1 hora", "3 días" between two moments (at least "menos de un minuto"). */
export function lapso(desde: string, hasta: string): string {
  const min = Math.floor((Date.parse(hasta) - Date.parse(desde)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "menos de un minuto";
  if (min < 60) return `${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "día" : "días"}`;
}

/**
 * The history line for this opening, or null when it isn't noted: the person
 * wasn't notified about this file (not the responsible of the step it waits
 * for, nor the uploader of a rejected version), or it was already noted for
 * them and this version.
 */
export function planApertura(
  a: ArchivoRegistro,
  flujo: Pick<Flujo, "pasos"> | null,
  quien: { id: string; nombre: string; grupos: Set<string> },
  anteriores: Pick<EntradaHistorial, "accion" | "usuarioId" | "version" | "archivoId">[],
  momento: string
): Linea | null {
  if (anteriores.some((e) => e.accion === "archivo-abierto" && e.archivoId === a.id && e.usuarioId === quien.id && (e.version ?? null) === (a.revision ?? null))) return null;
  const paso = a.pasos[a.pasoActual];
  const responsable = ESPERANDO.includes(a.estado) && responsablesArchivo(a, flujo).some((r) => (r.tipo === "persona" ? r.id === quien.id : quien.grupos.has(r.id)));
  const corrige = a.estado === "rechazado" && !!a.subidoPorId && a.subidoPorId === quien.id;
  if (!responsable && !corrige) return null;
  // The ToDo that told them: the open one for this step (or the correction) and this version.
  const tarea = [...(a.tareas ?? [])]
    .reverse()
    .find((t) => t.versionId === a.versionId && (responsable ? t.tipo === "revision" && t.pasoId === paso?.id : t.tipo === "correccion"));
  const aviso = tarea ? `; lo avisó la tarea de Trimble ${tarea.etiqueta ? `${tarea.etiqueta} ` : ""}del ${fechaHora(tarea.creada)} (${lapso(tarea.creada, momento)} antes)` : "";
  const v = `la versión ${a.revision ?? "?"} de «${a.nombre}»`;
  return {
    proyecto: a.proyecto,
    flujoId: a.flujoId,
    accion: "archivo-abierto",
    usuario: quien.nombre,
    usuarioId: quien.id,
    detalle: responsable ? `Abrió ${v} como responsable de «${paso?.nombre ?? ""}»${aviso}.` : `Abrió ${v}, que le rechazaron, para corregirla${aviso}.`,
    archivoId: a.id,
    fileId: a.fileId,
    version: a.revision ?? null,
    ocurrido: momento,
  };
}

/** { archivoId }: notes that the caller opened the file, when it applies. Never fails the opening. */
export async function registrarApertura(ctx: Ctx, body: unknown): Promise<{ anotado: boolean }> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.archivoId !== "string" || !UUID.test(o.archivoId)) throw new FlujoError("El archivo no es válido.");
  const a = (await ctx.store.archivos(ctx.projectId)).find((x) => x.id === o.archivoId);
  if (!a) throw new FlujoError("Ese archivo no está registrado en este proyecto.", 404);
  const flujo = await ctx.store.flujo(a.flujoId);
  const grupos = responsablesArchivo(a, flujo)
    .filter((r) => r.tipo === "grupo")
    .map((r) => r.id);
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  const anteriores = await ctx.store.historial(ctx.projectId, { archivoId: a.id, limite: 500 });
  const linea = planApertura(a, flujo, { id: ctx.caller.id, nombre: ctx.caller.name, grupos: mios }, anteriores, (ctx.ahora?.() ?? new Date()).toISOString());
  if (!linea) return { anotado: false };
  await ctx.store.registrar(linea);
  return { anotado: true };
}
