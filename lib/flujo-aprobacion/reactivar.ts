/**
 * "Reactivar el flujo" (owner, 10-11-2026: "si solo si el flujo arroja el
 * mensaje «N archivo tiene una versión más nueva en Trimble…» el usuario
 * creador tenga un botón de reactivar el flujo… se debe guardar toda la
 * trazabilidad"). Its creator or an administrator brings the newer versions
 * in: each one is reviewed again from the first step and its responsible gets
 * the ToDo; files without a newer version stay as they are. A deactivated flow
 * becomes active again. The flow stays closed for editing, and nothing is
 * deleted: the decisions on the earlier versions stay in the history.
 */
import { fechaHora } from "../compras/formato";
import { avisarRevision } from "./decisiones";
import { FlujoError } from "./errores";
import { conflictosArchivos, puedeCambiar } from "./flujos";
import { detalleCambio, planReactivar } from "./registro";
import { revisarFlujo } from "./revision";
import { Ctx, estado } from "./service";
import { cerrarTareas } from "./tareas";
import type { ArchivoRegistro, EntradaHistorial, EstadoFlujos } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/** { id, version }: reactivates a flow that has files with a newer version in Trimble. */
export async function reactivarFlujo(ctx: Ctx, body: unknown): Promise<EstadoFlujos> {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof o.id !== "string" || !UUID.test(o.id)) throw new FlujoError("El flujo no es válido.");
  const todos = await ctx.store.flujos(ctx.projectId);
  const f = todos.find((x) => x.id === o.id);
  if (!f) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  if (!puedeCambiar(f, { id: ctx.caller.id, esAdmin: ctx.caller.isAdmin })) {
    throw new FlujoError(`Solo quien creó este flujo${f.creadoPor ? ` (${f.creadoPor})` : ""} o un administrador del proyecto en Trimble puede reactivarlo.`, 403, "sin-permiso");
  }
  if (o.version !== f.version) throw new FlujoError("Otra persona cambió este flujo hace un momento: recarga para verlo.", 409, "version-conflict");
  const conNueva = (await ctx.store.archivos(ctx.projectId)).filter((a) => a.flujoId === f.id && a.estado !== "retirado" && !!a.versionNueva?.versionId);
  if (!conNueva.length) throw new FlujoError(`«${f.hito}» no tiene archivos con una versión más nueva en Trimble: no hay nada que reactivar.`, 409, "sin-version-nueva");

  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  let flujo = f;
  if (!f.activo) {
    const malos = conflictosArchivos(f, todos);
    if (malos.length) throw new FlujoError(`No se puede reactivar: ${malos.join(" ")}`, 409, "conflicto");
    const activo = await ctx.store.actualizarFlujo(f.id, f.version, { activo: true, actualizado: momento, actualizadoPor: ctx.caller.name });
    if (!activo) throw new FlujoError("Otra persona cambió este flujo hace un momento: recarga para verlo.", 409, "version-conflict");
    flujo = activo;
  }

  // Trimble again, so the newest version is the one that enters (if it fails, the noted ones enter).
  await revisarFlujo(ctx, { flujoId: flujo.id }).catch(() => null);
  const plan = planReactivar(flujo, await ctx.store.archivos(ctx.projectId), momento);
  const lineas: Linea[] = [];
  const hechos: ArchivoRegistro[] = [];
  for (const c of plan) {
    // Only while nobody decided or changed it in between.
    const h = await ctx.store.decidirArchivo(c.id, { versionId: c.antes.versionId, pasoActual: c.antes.pasoActual, estado: c.antes.estado }, c.cambios);
    if (!h) continue;
    hechos.push(h);
    lineas.push({
      proyecto: ctx.projectId,
      flujoId: flujo.id,
      accion: "version-reactivada",
      usuario: ctx.caller.name,
      usuarioId: ctx.caller.id,
      detalle: detalleCambio(c, flujo.hito, fechaHora),
      archivoId: h.id,
      fileId: h.fileId,
      version: h.revision,
      ocurrido: momento,
    });
  }

  const lista = hechos.map((h) => `«${h.nombre}» versión ${h.revision ?? "?"}`).join("; ");
  const activado = !f.activo ? " (estaba desactivado: queda activo)" : "";
  lineas.unshift({
    proyecto: ctx.projectId,
    flujoId: flujo.id,
    accion: "flujo-reactivado",
    usuario: ctx.caller.name,
    usuarioId: ctx.caller.id,
    detalle: hechos.length
      ? `Reactivó «${flujo.hito}»${activado}: ${hechos.length === 1 ? "entra" : "entran"} ${lista}. Se revisan desde el primer paso; lo decidido antes queda en el historial.`
      : `Reactivó «${flujo.hito}»${activado}, pero las versiones nuevas ya no estaban en Trimble: no entró nada.`,
    ocurrido: momento,
  });
  // The first step's responsible gets the ToDo; the ToDos of what was replaced are closed.
  const avisados = await avisarRevision(ctx, flujo, hechos, momento);
  lineas.push(...avisados.lineas);
  lineas.push(...(await cerrarTareas(ctx, hechos, momento)));
  await ctx.store.registrarVarios(lineas);

  const mensaje = hechos.length
    ? `Se reactivó «${flujo.hito}»${activado}: ${lista} ${hechos.length === 1 ? "entra" : "entran"} a revisión desde el primer paso.${avisados.enviados ? ` Se avisó con ${contar(avisados.enviados, "tarea", "tareas")} de Trimble.` : ""}${avisados.fallidos ? ` ${contar(avisados.fallidos, "aviso no se pudo enviar", "avisos no se pudieron enviar")} (ver Historial).` : ""}`
    : `Las versiones nuevas ya no están en Trimble: no entró nada.${activado ? " El flujo quedó activo." : ""}`;
  return { ...(await estado(ctx)), mensaje };
}
