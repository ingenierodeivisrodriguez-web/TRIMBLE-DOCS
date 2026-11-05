/**
 * "Flujo de aprobación", phase 2: finding and registering the files of each
 * flow's review folders. Trimble has no notices of new uploads, so the screen
 * asks for a review of every active flow when it opens and with "Revisar
 * ahora", with the session of whoever opens it (they see what Trimble lets
 * them see). One review per flow at a time. A registered file that isn't seen
 * any more is retired only after a complete walk by an administrator (who sees
 * every folder) and after Trimble confirms it is gone or out of the flow.
 */
import { fechaHora } from "../compras/formato";
import { buildFileViewerUrl } from "../format";
import { FlujoError } from "./errores";
import { flujoDe } from "./flujos";
import { LIMITES, recorrer } from "./recorrido";
import { Cambio, detalleCambio, ESPERANDO, meToca, planRegistro, responsablesArchivo } from "./registro";
import type { Ctx } from "./service";
import type { ArchivoInfo, ArchivoRegistro, EntradaHistorial, ResumenRevision } from "./types";

/** How long one review holds its flow (a stuck one frees itself). */
const TOMA_MS = 3 * 60_000;
/** Missing files checked one by one in Trimble per review. */
const MAX_COMPROBAR = 50;
/** Changes written at the same time. */
const TANDA = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ahoraDe = (ctx: Ctx) => ctx.ahora?.() ?? new Date();
const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Linea = Omit<EntradaHistorial, "id" | "creado">;

async function enTandas<T>(xs: T[], f: (x: T) => Promise<void>) {
  for (let i = 0; i < xs.length; i += TANDA) await Promise.all(xs.slice(i, i + TANDA).map(f));
}

/** { flujoId }: walks a flow's review folders and registers what changed. */
export async function revisarFlujo(ctx: Ctx, body: unknown): Promise<ResumenRevision> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.flujoId !== "string" || !UUID.test(o.flujoId)) throw new FlujoError("El flujo no es válido.");
  const flujo = await ctx.store.flujo(o.flujoId);
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  const base: ResumenRevision = { flujoId: flujo.id, hito: flujo.hito, ocupado: false, completo: false, nuevos: 0, nuevasVersiones: 0, retirados: 0, reaparecidos: 0, sinCambios: 0, carpetas: 0, mensaje: "" };
  if (!flujo.activo) return { ...base, mensaje: `«${flujo.hito}» está desactivado: no se revisa.` };

  const inicio = ahoraDe(ctx);
  const momento = inicio.toISOString();
  if (!(await ctx.store.tomarRevision(flujo.id, new Date(inicio.getTime() + TOMA_MS).toISOString(), momento))) {
    return { ...base, ocupado: true, mensaje: `Otra persona está revisando «${flujo.hito}» en este momento; lo que encuentre aparecerá al recargar.` };
  }
  try {
    const todos = await ctx.store.flujos(ctx.projectId);
    const excluir = new Set(todos.filter((f) => f.activo).flatMap((f) => f.carpetas.map((c) => c.id)));
    const r = await recorrer(flujo.carpetas, excluir, { items: (id) => ctx.tc.items(id), reloj: ctx.reloj ?? Date.now }, ctx.limites ?? LIMITES);
    const plan = planRegistro(flujo, await ctx.store.archivos(ctx.projectId), r.vistos, momento);
    const lineas: Linea[] = [];
    const linea = (a: Pick<ArchivoRegistro, "id" | "fileId" | "revision">, accion: string, detalle: string, quien: { usuario: string | null; usuarioId: string | null }, ocurrido: string | null): Linea => ({
      proyecto: ctx.projectId,
      flujoId: flujo.id,
      accion,
      ...quien,
      detalle,
      archivoId: a.id,
      fileId: a.fileId,
      version: a.revision,
      ocurrido,
    });

    // New files: who uploaded and when, as Trimble says.
    const creados = await ctx.store.crearArchivos(plan.crear);
    for (const a of creados) {
      lineas.push(
        linea(
          a,
          "archivo-detectado",
          `Subió la versión ${a.revision ?? "?"}${a.subido ? ` el ${fechaHora(a.subido)}` : ""} en ${a.ruta}. Pendiente de revisión: ${a.pasos[0]?.nombre ?? "—"}. Lo registró ${ctx.caller.name} al revisar el flujo.`,
          { usuario: a.subidoPor || null, usuarioId: a.subidoPorId },
          a.subido
        )
      );
    }

    // New versions, files that reappear or come from another flow, renames.
    await enTandas(plan.actualizar, async (c: Cambio) => {
      const a = await ctx.store.actualizarArchivo(c.id, c.cambios);
      if (!c.accion) return;
      const subio = c.accion === "version-reemplazada" || c.accion === "nueva-version";
      lineas.push(
        linea(a, c.accion, detalleCambio(c, flujo.hito, fechaHora), subio ? { usuario: a.subidoPor || null, usuarioId: a.subidoPorId } : { usuario: ctx.caller.name, usuarioId: ctx.caller.id }, subio ? a.subido : momento)
      );
    });

    // Missing files: only after a complete walk by an administrator, and only what Trimble confirms.
    let retirados = 0;
    if (r.completo && ctx.caller.isAdmin) {
      for (const a of plan.faltantes.slice(0, MAX_COMPROBAR)) {
        let motivo: string | null = null;
        try {
          const e = await ctx.tc.archivo(a.fileId);
          if (flujoDe(e, todos)?.flujo.id !== flujo.id) motivo = `Se movió fuera de las carpetas de revisión del flujo (ahora en ${e.ruta}).`;
        } catch (err) {
          if ((err as { status?: number }).status === 404) motivo = "Ya no está en Trimble (se borró, o se movió a una carpeta que no se ve).";
        }
        if (!motivo) continue;
        const hecho = await ctx.store.actualizarArchivo(a.id, { estado: "retirado", actualizado: momento });
        lineas.push(linea(hecho, "archivo-retirado", `${motivo} Queda como retirado; no se borra nada.`, { usuario: ctx.caller.name, usuarioId: ctx.caller.id }, momento));
        retirados++;
      }
    }
    await ctx.store.registrarVarios(lineas);

    const nuevasVersiones = plan.actualizar.filter((c) => c.accion === "nueva-version" || c.accion === "version-reemplazada").length;
    const reaparecidos = plan.actualizar.filter((c) => c.accion === "archivo-reaparecido" || c.accion === "archivo-cambio-flujo").length;
    const partes = [
      creados.length ? contar(creados.length, "archivo nuevo", "archivos nuevos") : "",
      nuevasVersiones ? contar(nuevasVersiones, "versión nueva", "versiones nuevas") : "",
      reaparecidos ? contar(reaparecidos, "archivo que vuelve", "archivos que vuelven") : "",
      retirados ? contar(retirados, "retirado", "retirados") : "",
    ].filter(Boolean);
    const faltan = plan.faltantes.length - retirados;
    const avisos = [
      r.completo ? "" : ` Revisión incompleta (${r.motivo}): lo que no se vio no se marcó como retirado.`,
      r.completo && faltan > 0 && !ctx.caller.isAdmin ? ` ${contar(faltan, "archivo registrado no apareció", "archivos registrados no aparecieron")} en tu revisión; solo la de un administrador los confirma como retirados.` : "",
    ].join("");
    return {
      ...base,
      completo: r.completo,
      nuevos: creados.length,
      nuevasVersiones,
      retirados,
      reaparecidos,
      sinCambios: plan.sinCambios,
      carpetas: r.carpetas,
      mensaje: `«${flujo.hito}»: ${partes.length ? partes.join(", ") : "sin cambios"}.${avisos}`,
    };
  } finally {
    await ctx.store.terminarRevision(flujo.id, ahoraDe(ctx).toISOString(), ctx.caller.name);
  }
}

/** Every registered file with its flow, the step it waits for, who has it and whether it is the caller's turn. */
export async function listarArchivos(ctx: Ctx): Promise<{ yo: string; esAdmin: boolean; archivos: ArchivoInfo[] }> {
  const [flujos, asignaciones, archivos] = await Promise.all([ctx.store.flujos(ctx.projectId), ctx.store.asignaciones(ctx.projectId), ctx.store.archivos(ctx.projectId)]);
  const activas = asignaciones.filter((a) => a.activa);
  const grupos = [...new Set(activas.filter((a) => a.quienTipo === "grupo").map((a) => a.quienId))];
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  const hitos = new Map(flujos.map((f) => [f.id, f.hito]));
  return {
    yo: ctx.caller.id,
    esAdmin: ctx.caller.isAdmin,
    archivos: archivos.map((a) => {
      const resp = responsablesArchivo(a, activas);
      return {
        ...a,
        hito: hitos.get(a.flujoId) ?? "",
        pasoNombre: ESPERANDO.includes(a.estado) ? (a.pasos[a.pasoActual]?.nombre ?? "") : "",
        responsables: resp.map((r) => (r.quienTipo === "grupo" ? `${r.quienNombre} (grupo)` : r.quienNombre)),
        meToca: meToca(a, resp, ctx.caller.id, mios),
        enlace: buildFileViewerUrl(ctx.projectId, { id: a.fileId, ext: a.tipo, versionId: a.versionId ?? a.fileId }),
      };
    }),
  };
}
