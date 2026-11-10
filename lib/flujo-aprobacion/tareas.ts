/**
 * The Trimble ToDos a flow creates, kept on each file since 10-11-2026 so they
 * are closed when they are done (owner: "que la tarea creada en Trimble cambie
 * a estado cerrado cuando el flujo sea aprobado o rechazado"):
 * - a review ToDo, when none of its files still waits for that step and
 *   version (a ToDo may cover several files of one step);
 * - a correction ToDo (to the uploader of a rejected version), when the file is
 *   no longer rejected at that version (its corrected version entered).
 * Closing never blocks a decision: what happened goes to the history.
 */
import { cerrarTarea } from "./avisos";
import { ESPERANDO } from "./registro";
import type { Ctx } from "./service";
import type { ArchivoRegistro, Aviso, EntradaHistorial, TareaTrimble } from "./types";

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/** Whether a file still waits for what a ToDo asked of it. */
export function sigueEsperando(t: Pick<TareaTrimble, "tipo" | "pasoId" | "versionId">, a: Pick<ArchivoRegistro, "estado" | "pasos" | "pasoActual" | "versionId">): boolean {
  if (a.versionId !== t.versionId) return false;
  if (t.tipo === "correccion") return a.estado === "rechazado";
  return ESPERANDO.includes(a.estado) && a.pasos[a.pasoActual]?.id === t.pasoId;
}

/** The open ToDos of the changed files that none of their files waits for any more. */
export function tareasPorCerrar(cambiadas: Pick<ArchivoRegistro, "id">[], todas: ArchivoRegistro[]): { tarea: TareaTrimble; archivos: ArchivoRegistro[] }[] {
  const ids = new Set(cambiadas.map((c) => c.id));
  const abiertas = new Map<string, TareaTrimble>();
  for (const a of todas) if (ids.has(a.id)) for (const t of a.tareas ?? []) if (!t.cerrada && !abiertas.has(t.id)) abiertas.set(t.id, t);
  const out: { tarea: TareaTrimble; archivos: ArchivoRegistro[] }[] = [];
  for (const [id, tarea] of abiertas) {
    const con = todas.filter((a) => (a.tareas ?? []).some((t) => t.id === id && !t.cerrada));
    if (con.some((a) => sigueEsperando((a.tareas ?? []).find((t) => t.id === id)!, a))) continue;
    out.push({ tarea, archivos: con });
  }
  return out;
}

/** Notes on each file the ToDos just created about it (best effort: a ToDo not noted is just never closed by the flow). */
export async function guardarTareas(ctx: Ctx, creadas: { aviso: Aviso; todoId: string }[], filas: ArchivoRegistro[], momento: string): Promise<void> {
  const porId = new Map(filas.map((f) => [f.id, f]));
  for (const { aviso, todoId } of creadas) {
    if (!aviso.tipo) continue;
    for (const id of aviso.archivos) {
      const f = porId.get(id);
      if (!f) continue;
      const tarea: TareaTrimble = { id: todoId, tipo: aviso.tipo, pasoId: aviso.pasoId ?? null, versionId: f.versionId, titulo: aviso.titulo, creada: momento };
      try {
        porId.set(id, await ctx.store.actualizarArchivo(id, { tareas: [...(f.tareas ?? []), tarea] }));
      } catch {
        // The decision or the review already happened; this ToDo stays open in Trimble.
      }
    }
  }
}

/** Closes the ToDos the changed files no longer need and returns the history lines. Never throws. */
export async function cerrarTareas(ctx: Ctx, cambiadas: Pick<ArchivoRegistro, "id">[], momento: string): Promise<Linea[]> {
  if (!ctx.tc.actualizarTarea || !cambiadas.length) return [];
  try {
    const lineas: Linea[] = [];
    for (const { tarea, archivos } of tareasPorCerrar(cambiadas, await ctx.store.archivos(ctx.projectId))) {
      const r = await cerrarTarea((cuerpo) => ctx.tc.actualizarTarea!(tarea.id, cuerpo));
      for (const a of archivos) {
        const tareas = (a.tareas ?? []).map((t) => (t.id === tarea.id ? { ...t, cerrada: r.ok ? momento : null, cierre: r.ok ? (r.estado ?? "") : r.mensaje.slice(0, 300) } : t));
        await ctx.store.actualizarArchivo(a.id, { tareas }).catch(() => undefined);
      }
      lineas.push({
        proyecto: ctx.projectId,
        flujoId: archivos[0]?.flujoId ?? null,
        accion: r.ok ? "tarea-cerrada" : "tarea-no-cerrada",
        usuario: ctx.caller.name,
        usuarioId: ctx.caller.id,
        detalle: r.ok ? `Cerró la tarea de Trimble «${tarea.titulo}»: ${r.mensaje}` : `No se pudo cerrar la tarea de Trimble «${tarea.titulo}»: ${r.mensaje}`,
        archivoId: archivos.length === 1 ? archivos[0].id : null,
        fileId: archivos.length === 1 ? archivos[0].fileId : null,
        ocurrido: momento,
      });
    }
    return lineas;
  } catch {
    return [];
  }
}
