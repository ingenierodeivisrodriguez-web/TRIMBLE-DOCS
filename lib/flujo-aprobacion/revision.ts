/**
 * "Flujo de aprobación", phase 2: registering a flow's chosen files and their
 * new versions. Trimble has no notices of new uploads, so the screen asks for
 * a review of every active flow when it opens and with "Revisar ahora" (and
 * saving a flow does it at once), with the session of whoever asks (they see
 * what Trimble lets them see). One review per flow at a time. A file taken out
 * of the flow is retired at once; one Trimble says no longer exists, only in
 * an administrator's review (who sees every folder). Nothing is deleted.
 */
import { fechaHora } from "../compras/formato";
import { avisarRevision, enlaceDe } from "./decisiones";
import { FlujoError } from "./errores";
import { nombreResponsable } from "./flujos";
import { LIMITES, leerArchivos } from "./recorrido";
import { Cambio, detalleCambio, ESPERANDO, meToca, planRegistro, responsablesArchivo } from "./registro";
import type { Ctx } from "./service";
import type { ArchivoInfo, ArchivoRegistro, EntradaHistorial, ResumenRevision } from "./types";

/** How long one review holds its flow (a stuck one frees itself). */
const TOMA_MS = 3 * 60_000;
/** Changes written at the same time. */
const TANDA = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ahoraDe = (ctx: Ctx) => ctx.ahora?.() ?? new Date();
const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Linea = Omit<EntradaHistorial, "id" | "creado">;

async function enTandas<T>(xs: T[], f: (x: T) => Promise<void>) {
  for (let i = 0; i < xs.length; i += TANDA) await Promise.all(xs.slice(i, i + TANDA).map(f));
}

/** { flujoId }: reads a flow's chosen files in Trimble and registers what changed. */
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
    // Each chosen file where it was last seen (registered files keep their latest location).
    const registrados = await ctx.store.archivos(ctx.projectId);
    const suyos = new Map(registrados.filter((x) => x.flujoId === flujo.id && x.carpetaId).map((x) => [x.fileId, x]));
    const elegidos = flujo.archivos.map((a) => {
      const x = suyos.get(a.id);
      return x ? { id: a.id, ruta: x.ruta, ancestros: x.ancestros } : a;
    });
    const r = await leerArchivos(elegidos, { items: (id) => ctx.tc.items(id), archivo: (id) => ctx.tc.archivo(id), reloj: ctx.reloj ?? Date.now }, ctx.limites ?? LIMITES);
    const plan = planRegistro(flujo, registrados, r.vistos, momento);
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
          `Subió la versión ${a.revision ?? "?"}${a.subido ? ` el ${fechaHora(a.subido)}` : ""} en ${a.ruta}. Pendiente de revisión: ${a.pasos[0]?.nombre ?? "—"}. Lo registró ${ctx.caller.name} en el flujo.`,
          { usuario: a.subidoPor || null, usuarioId: a.subidoPorId },
          a.subido
        )
      );
    }

    // New versions, files that reappear or come from another flow, renames and moves.
    const aAvisar: ArchivoRegistro[] = [...creados];
    await enTandas(plan.actualizar, async (c: Cambio) => {
      const a = await ctx.store.actualizarArchivo(c.id, c.cambios);
      if (!c.accion) return;
      if (ESPERANDO.includes(a.estado) && c.accion !== "archivo-reaparecido") aAvisar.push(a);
      const subio = c.accion === "version-reemplazada" || c.accion === "nueva-version";
      lineas.push(
        linea(a, c.accion, detalleCambio(c, flujo.hito, fechaHora), subio ? { usuario: a.subidoPor || null, usuarioId: a.subidoPorId } : { usuario: ctx.caller.name, usuarioId: ctx.caller.id }, subio ? a.subido : momento)
      );
    });

    // Missing files: taken out of the flow (retired at once), or gone from Trimble (only an administrator's review retires them).
    const elegidosIds = new Set(flujo.archivos.map((a) => a.id));
    const borrados = new Set(r.borrados);
    let retirados = 0;
    let noVistos = 0;
    for (const a of plan.faltantes) {
      const motivo = !elegidosIds.has(a.fileId)
        ? `Se quitó del flujo «${flujo.hito}».`
        : borrados.has(a.fileId) && ctx.caller.isAdmin
          ? "Ya no está en Trimble (se borró, o se movió a una carpeta que no se ve)."
          : null;
      if (!motivo) {
        if (borrados.has(a.fileId)) noVistos++;
        continue;
      }
      const hecho = await ctx.store.actualizarArchivo(a.id, { estado: "retirado", actualizado: momento });
      lineas.push(linea(hecho, "archivo-retirado", `${motivo} Queda como retirado; no se borra nada.`, { usuario: ctx.caller.name, usuarioId: ctx.caller.id }, momento));
      retirados++;
    }

    // A Trimble ToDo to the responsible of the first step of what now waits (phase 3).
    const avisados = await avisarRevision(ctx, flujo, aAvisar, momento);
    lineas.push(...avisados.lineas);
    await ctx.store.registrarVarios(lineas);

    const nuevasVersiones = plan.actualizar.filter((c) => c.accion === "nueva-version" || c.accion === "version-reemplazada").length;
    const reaparecidos = plan.actualizar.filter((c) => c.accion === "archivo-reaparecido" || c.accion === "archivo-cambio-flujo").length;
    const partes = [
      creados.length ? contar(creados.length, "archivo nuevo", "archivos nuevos") : "",
      nuevasVersiones ? contar(nuevasVersiones, "versión nueva", "versiones nuevas") : "",
      reaparecidos ? contar(reaparecidos, "archivo que vuelve", "archivos que vuelven") : "",
      retirados ? contar(retirados, "retirado", "retirados") : "",
    ].filter(Boolean);
    const avisos = [
      r.completo ? "" : ` Revisión incompleta (${r.motivo}): lo que no se vio no se marcó como retirado.`,
      noVistos > 0 ? ` ${contar(noVistos, "archivo registrado no apareció", "archivos registrados no aparecieron")} en tu revisión; solo la de un administrador los confirma como retirados.` : "",
      avisados.enviados ? ` Se avisó a los revisores con ${contar(avisados.enviados, "tarea", "tareas")} de Trimble.` : "",
      avisados.fallidos ? ` ${contar(avisados.fallidos, "aviso no se pudo enviar", "avisos no se pudieron enviar")} (ver Historial).` : "",
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
  const [flujos, archivos] = await Promise.all([ctx.store.flujos(ctx.projectId), ctx.store.archivos(ctx.projectId)]);
  const porId = new Map(flujos.map((f) => [f.id, f]));
  const resp = new Map(archivos.map((a) => [a.id, responsablesArchivo(a, porId.get(a.flujoId))]));
  const grupos = [...new Set([...resp.values()].flat().filter((r) => r.tipo === "grupo").map((r) => r.id))];
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  return {
    yo: ctx.caller.id,
    esAdmin: ctx.caller.isAdmin,
    archivos: archivos.map((a) => {
      const r = resp.get(a.id) ?? [];
      const flujo = porId.get(a.flujoId);
      return {
        ...a,
        hito: flujo?.hito ?? "",
        pasoNombre: ESPERANDO.includes(a.estado) ? (a.pasos[a.pasoActual]?.nombre ?? "") : "",
        responsables: r.map(nombreResponsable),
        meToca: meToca(a, r, ctx.caller.id, mios),
        enlace: enlaceDe(ctx.projectId, a),
        destino: flujo?.destino?.ruta ?? null,
      };
    }),
  };
}
