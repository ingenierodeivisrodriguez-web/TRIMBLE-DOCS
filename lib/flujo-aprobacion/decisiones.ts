/**
 * "Flujo de aprobación", phase 3: approving and rejecting, and the notices.
 * A decision is about the version the person saw: if another one arrived (in
 * the register or already in Trimble) it is refused and they review the new
 * one. Two people deciding at once: the second gets "someone decided first".
 * Notices go as Trimble ToDos (they never block a decision: a failure is noted
 * in the history).
 */
import { buildFileViewerUrl } from "../format";
import { avisoRechazo, avisosRevision, enviarAviso } from "./avisos";
import { planDecision, puedeDecidir, revisarTexto } from "./decision";
import { FlujoError } from "./errores";
import type { Ctx } from "./service";
import { ResultadoTraslado, trasladar } from "./trasladar";
import type { ArchivoRegistro, Asignacion, Aviso, EntradaHistorial, Traslado } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ToDos sent per review or decision. */
const MAX_AVISOS = 20;

export const enlaceDe = (projectId: string, a: Pick<ArchivoRegistro, "fileId" | "tipo" | "versionId">) => buildFileViewerUrl(projectId, { id: a.fileId, ext: a.tipo, versionId: a.versionId ?? a.fileId });

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/** Sends the ToDos and returns the history lines and what to tell the person. */
export async function notificar(ctx: Ctx, flujoId: string, avisos: Aviso[], momento: string): Promise<{ lineas: Linea[]; enviados: number; fallidos: number; textos: string[] }> {
  const lineas: Linea[] = [];
  const textos: string[] = [];
  let enviados = 0;
  let fallidos = 0;
  for (const aviso of avisos.slice(0, MAX_AVISOS)) {
    const r = await enviarAviso((cuerpo) => ctx.tc.crearTarea(cuerpo), ctx.projectId, aviso, (g) => ctx.tc.miembros(g).catch(() => []));
    if (r.ok) enviados++;
    else fallidos++;
    textos.push(r.mensaje);
    lineas.push({
      proyecto: ctx.projectId,
      flujoId,
      accion: r.ok ? "aviso-enviado" : "aviso-fallido",
      usuario: ctx.caller.name,
      usuarioId: ctx.caller.id,
      detalle: `${r.mensaje}${aviso.archivos.length > 1 ? ` (${aviso.archivos.length} archivos)` : ""}`,
      archivoId: aviso.archivos.length === 1 ? aviso.archivos[0] : null,
      ocurrido: momento,
    });
  }
  return { lineas, enviados, fallidos, textos };
}

/** The ToDos for files that now wait for someone (new, new version, next step). */
export async function avisarRevision(ctx: Ctx, flujoId: string, archivos: ArchivoRegistro[], asignaciones: Asignacion[], hito: string, momento: string) {
  if (!archivos.length) return { lineas: [], enviados: 0, fallidos: 0, textos: [] };
  const avisos = avisosRevision(archivos, asignaciones.filter((a) => a.activa), new Map([[flujoId, hito]]), (a) => enlaceDe(ctx.projectId, a));
  return notificar(ctx, flujoId, avisos, momento);
}

/** { archivoId, versionId (the one seen), texto }: approves or rejects the step the file waits for. */
export async function decidir(ctx: Ctx, body: unknown, decision: "aprobar" | "rechazar"): Promise<{ mensaje: string; aviso: string | null; traslado: Traslado | null }> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.archivoId !== "string" || !UUID.test(o.archivoId)) throw new FlujoError("El archivo no es válido.");
  const texto = revisarTexto(decision, o.texto);
  if (texto.error) throw new FlujoError(texto.error);
  const a = (await ctx.store.archivos(ctx.projectId)).find((x) => x.id === o.archivoId);
  if (!a) throw new FlujoError("Ese archivo no está registrado en este proyecto.", 404);
  if ((o.versionId ?? null) !== a.versionId) {
    throw new FlujoError(`Llegó la versión ${a.revision ?? "nueva"} después de que abriste este archivo: revísala antes de decidir.`, 409, "version-cambio");
  }
  const flujo = await ctx.store.flujo(a.flujoId);
  if (!flujo) throw new FlujoError("El flujo de este archivo ya no existe.", 404);
  const asignaciones = (await ctx.store.asignaciones(ctx.projectId)).filter((x) => x.activa && x.flujoId === a.flujoId);
  const grupos = [...new Set(asignaciones.filter((x) => x.quienTipo === "grupo").map((x) => x.quienId))];
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  const decisor = { id: ctx.caller.id, nombre: ctx.caller.name, esAdmin: ctx.caller.isAdmin, grupos: mios };
  const puede = puedeDecidir(a, asignaciones, decisor);
  if (puede.error) throw new FlujoError(puede.error, 403, "sin-permiso");

  // The version must still be the latest one in Trimble.
  const enTrimble = await ctx.tc.version(a.fileId);
  if (enTrimble && enTrimble !== a.versionId) {
    throw new FlujoError("En Trimble ya hay una versión más nueva de este archivo: pulsa «Revisar ahora» y revisa la nueva.", 409, "version-cambio");
  }

  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  const plan = planDecision(a, decision, decisor, puede.comoAdmin, texto.texto, momento);
  const hecho = await ctx.store.decidirArchivo(a.id, { versionId: a.versionId, pasoActual: a.pasoActual, estado: a.estado }, plan.cambios);
  if (!hecho) throw new FlujoError("Otra persona decidió sobre este archivo, o llegó una versión nueva, hace un momento: recarga para verlo.", 409, "ya-decidido");

  const lineas: Linea[] = [
    { proyecto: ctx.projectId, flujoId: a.flujoId, accion: plan.accion, usuario: ctx.caller.name, usuarioId: ctx.caller.id, detalle: plan.detalle, archivoId: a.id, fileId: a.fileId, version: a.revision, ocurrido: momento },
  ];
  let aviso: string | null = null;
  if (plan.siguiente) {
    const r = await avisarRevision(ctx, a.flujoId, [hecho], asignaciones, flujo.hito, momento);
    lineas.push(...r.lineas);
    aviso = r.textos[0] ?? `Nadie tiene asignado «${plan.siguiente.nombre}» en este archivo: no se avisó a nadie (solo un administrador puede decidirlo).`;
  } else if (plan.accion === "rechazado") {
    const av = avisoRechazo(hecho, plan.firma, flujo.hito, enlaceDe(ctx.projectId, hecho));
    if (av) {
      const r = await notificar(ctx, a.flujoId, [av], momento);
      lineas.push(...r.lineas);
      aviso = r.textos[0] ?? null;
    } else {
      aviso = "Trimble no dice quién subió esta versión: no se pudo avisar a nadie.";
    }
  }
  await ctx.store.registrarVarios(lineas);

  // The last step: the approved version goes to the destination folder now, with the approver's session.
  let traslado: ResultadoTraslado | null = null;
  if (plan.accion === "aprobado") {
    traslado = await trasladar(ctx, a.id).catch((err: unknown) => ({ traslado: null, mensaje: `No se pudo copiar a la carpeta destino: ${err instanceof Error ? err.message : String(err)}` }));
  }

  const mensaje =
    plan.accion === "rechazado"
      ? `«${a.nombre}» queda rechazado (versión ${a.revision ?? "?"}).`
      : plan.accion === "aprobado"
        ? `«${a.nombre}» queda aprobado (versión ${a.revision ?? "?"}). ${traslado?.mensaje ?? ""}`.trim()
        : `Aprobaste «${plan.firma.paso}» de «${a.nombre}»: pasa a «${plan.siguiente?.nombre}».`;
  return { mensaje, aviso, traslado: traslado?.traslado ?? null };
}
