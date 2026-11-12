/**
 * "Flujo de aprobación", phase 3: approving and rejecting, and the notices.
 * A decision is about the version the person saw (the flow's own version:
 * since 10-11-2026 a newer one in Trimble doesn't stop it, it is noted in the
 * decision). Two people deciding at once: the second gets "someone decided first".
 * Notices go as Trimble ToDos (they never block a decision: a failure is noted
 * in the history).
 */
import { buildFileViewerUrl } from "../format";
import type { ProjectUser } from "../trimbleApi";
import { avisoRechazo, avisosRevision, enviarAviso, FlujoTarea } from "./avisos";
import { configDe, destinatarios, enlaceBoton, enviarCorreos, mensajeErrorCorreo } from "./correo";
import { planDecision, puedeDecidir, revisarTexto } from "./decision";
import { FlujoError } from "./errores";
import type { Ctx } from "./service";
import { carpetaElegida, ResultadoTraslado, trasladar } from "./trasladar";
import { responsablesArchivo } from "./registro";
import { cerrarTareas, guardarTareas } from "./tareas";
import type { ArchivoRegistro, Aviso, CarpetaFlujo, EntradaHistorial, Flujo, Traslado } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ToDos sent per review or decision. */
const MAX_AVISOS = 20;

export const enlaceDe = (projectId: string, a: Pick<ArchivoRegistro, "fileId" | "tipo" | "versionId">) => buildFileViewerUrl(projectId, { id: a.fileId, ext: a.tipo, versionId: a.versionId ?? a.fileId });

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/**
 * Sends the ToDos and returns the history lines and what to tell the person.
 * Each ToDo created is noted on its files (`filas`), so it can be closed later.
 * Besides each ToDo, the extension's own e-mail to the same people (11-11-2026),
 * when Vercel has the Gmail account set; it goes even if Trimble refused the ToDo.
 * «Correos de aviso» (phase 2) says whether each one goes: the ToDo, the e-mail,
 * which notices, their texts and who gets a copy.
 * `enviados`/`fallidos` count ToDos and notices that failed; `correos`, e-mails sent.
 */
export async function notificar(
  ctx: Ctx,
  flujoId: string,
  avisos: Aviso[],
  momento: string,
  filas: ArchivoRegistro[] = []
): Promise<{ lineas: Linea[]; enviados: number; fallidos: number; correos: number; textos: string[] }> {
  const lineas: Linea[] = [];
  const textos: string[] = [];
  const creadas: { aviso: Aviso; todoId: string; etiqueta: string | null }[] = [];
  let enviados = 0;
  let fallidos = 0;
  let correos = 0;
  const config = await configDe(ctx);
  // How many ToDos the flow already made: if Trimble wants each code unique, the next one is «FLUJO-01-<n + 1>».
  let hechas = config.tareasTrimble && avisos.some((a) => a.trimble?.label)
    ? await ctx.store
        .archivos(ctx.projectId)
        .then((as) => new Set(as.filter((a) => a.flujoId === flujoId).flatMap((a) => (a.tareas ?? []).map((t) => t.id))).size)
        .catch(() => 0)
    : 0;
  // Read once per call: the team (for the e-mail addresses) and what every e-mail shares.
  let equipo: Promise<ProjectUser[]> | null = null;
  const personas = () => (equipo ??= ctx.tc.personas().catch(() => []));
  let comun: { proyecto: string; enlace: string } | null = null;
  for (const aviso of avisos.slice(0, MAX_AVISOS)) {
    const enArchivos = aviso.archivos.length > 1 ? ` (${aviso.archivos.length} archivos)` : "";
    const linea = (accion: string, detalle: string): Linea => ({
      proyecto: ctx.projectId,
      flujoId,
      accion,
      usuario: ctx.caller.name,
      usuarioId: ctx.caller.id,
      detalle: `${detalle}${enArchivos}`,
      archivoId: aviso.archivos.length === 1 ? aviso.archivos[0] : null,
      ocurrido: momento,
    });
    const dichos: string[] = [];
    // The Trimble ToDo (and Trimble's e-mail), unless «Correos de aviso» turned it off.
    if (config.tareasTrimble) {
      const otra = aviso.trimble?.label && hechas > 0 ? `${aviso.trimble.label}-${hechas + 1}` : null;
      const r = await enviarAviso((cuerpo) => ctx.tc.crearTarea(cuerpo), ctx.projectId, aviso, (g) => ctx.tc.miembros(g).catch(() => []), otra);
      if (r.ok && r.todoId) {
        creadas.push({ aviso, todoId: r.todoId, etiqueta: r.etiqueta });
        hechas++;
      }
      if (r.ok) enviados++;
      else fallidos++;
      lineas.push(linea(r.ok ? "aviso-enviado" : "aviso-fallido", r.mensaje));
      dichos.push(r.mensaje);
    }
    // The extension's own e-mail.
    const correo = ctx.correo;
    const datos = aviso.correo;
    if (correo && datos && config.activo && config.eventos[datos.tipo]) {
      comun ??= { proyecto: (await ctx.tc.nombreProyecto?.().catch(() => "")) || "Trimble Connect", enlace: enlaceBoton(ctx, config) };
      const deTodos = comun;
      const c = await destinatarios(aviso.para, personas, (g) => ctx.tc.miembros(g).catch(() => []))
        .then((gente) => enviarCorreos(correo, datos, gente, deTodos, { plantilla: config.textos[datos.tipo], copia: config.copia }))
        .catch((err: unknown) => ({ ok: false, enviados: 0, mensaje: `No se pudo enviar el correo: ${mensajeErrorCorreo(err)}.` }));
      correos += c.enviados;
      if (!c.ok) fallidos++;
      lineas.push(linea(c.ok ? "correo-enviado" : "correo-fallido", c.mensaje));
      dichos.push(c.mensaje);
    } else if (!config.tareasTrimble) {
      // Neither the ToDo nor the e-mail: noted, so nobody thinks the person knows.
      const quienes = aviso.para.map((p) => p.nombre + (p.tipo === "grupo" ? " (grupo)" : "")).join(", ");
      const porque = !correo ? "las tareas de Trimble están apagadas en «Correos de aviso» y no hay cuenta de Gmail en Vercel" : "en «Correos de aviso» están apagados la tarea de Trimble y el correo de este aviso";
      const texto = `No se avisó a ${quienes} («${aviso.titulo}»): ${porque}.`;
      fallidos++;
      lineas.push(linea("aviso-fallido", texto));
      dichos.push(texto);
    }
    if (dichos.length) textos.push(dichos.join(" "));
  }
  await guardarTareas(ctx, creadas, filas, momento);
  return { lineas, enviados, fallidos, correos, textos };
}

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** « Se avisó a los revisores con 1 tarea de Trimble y 2 correos. 1 aviso no se pudo enviar (ver Historial).» */
export function resumenAvisos(r: { enviados: number; fallidos: number; correos?: number }, aQuien = ""): string {
  const con = [r.enviados ? `${contar(r.enviados, "tarea", "tareas")} de Trimble` : "", r.correos ? contar(r.correos, "correo", "correos") : ""].filter(Boolean).join(" y ");
  return [con ? ` Se avisó${aQuien ? ` ${aQuien}` : ""} con ${con}.` : "", r.fallidos ? ` ${contar(r.fallidos, "aviso no se pudo enviar", "avisos no se pudieron enviar")} (ver Historial).` : ""].join("");
}

/** The ToDos for a flow's files that now wait for someone (new, new version, next step). */
export async function avisarRevision(ctx: Ctx, flujo: Pick<Flujo, "id"> & FlujoTarea, archivos: ArchivoRegistro[], momento: string) {
  if (!archivos.length) return { lineas: [], enviados: 0, fallidos: 0, correos: 0, textos: [] };
  const avisos = avisosRevision(archivos, flujo, (a) => enlaceDe(ctx.projectId, a));
  return notificar(ctx, flujo.id, avisos, momento, archivos);
}

/**
 * { archivoId, versionId (the one seen), texto, destino? }: approves or rejects
 * the step the file waits for. `destino` (a folder id, only when approving the
 * last step of a flow without destination): where the responsible puts the
 * approved version; it is checked before anything is decided.
 */
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
  const grupos = responsablesArchivo(a, flujo).filter((r) => r.tipo === "grupo").map((r) => r.id);
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  const decisor = { id: ctx.caller.id, nombre: ctx.caller.name, esAdmin: ctx.caller.isAdmin, grupos: mios };
  const puede = puedeDecidir(a, flujo, decisor);
  if (puede.error) throw new FlujoError(puede.error, 403, "sin-permiso");

  // The folder the responsible chose for the approved version.
  let elegida: CarpetaFlujo | null = null;
  if (typeof o.destino === "string" && o.destino) {
    if (decision !== "aprobar" || a.pasoActual !== a.pasos.length - 1) throw new FlujoError("La carpeta se elige al aprobar el último paso.");
    if (flujo.destino) throw new FlujoError(`Este flujo copia lo aprobado a su carpeta destino («${flujo.destino.ruta}»).`);
    elegida = await carpetaElegida(ctx, a, o.destino);
  }

  // The flow keeps its version: a newer one in Trimble is noted, so it is clear what was decided.
  const enTrimble = await ctx.tc.version(a.fileId).catch(() => null);
  const hayOtra = enTrimble ? enTrimble !== a.versionId : !!a.versionNueva;
  const conocida = a.versionNueva && (!enTrimble || a.versionNueva.versionId === enTrimble) ? a.versionNueva.revision : null;
  const nota = hayOtra ? textoOtraVersion(conocida) : "";

  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  const base = planDecision(a, decision, decisor, puede.comoAdmin, texto.texto, momento);
  const plan = nota ? { ...base, detalle: `${base.detalle.replace(/\.?$/, ".")} Ojo: ${nota}.` } : base;
  const hecho = await ctx.store.decidirArchivo(a.id, { versionId: a.versionId, pasoActual: a.pasoActual, estado: a.estado }, plan.cambios);
  if (!hecho) throw new FlujoError("Otra persona decidió sobre este archivo, o llegó una versión nueva, hace un momento: recarga para verlo.", 409, "ya-decidido");

  const lineas: Linea[] = [
    {
      proyecto: ctx.projectId,
      flujoId: a.flujoId,
      accion: plan.accion,
      usuario: ctx.caller.name,
      usuarioId: ctx.caller.id,
      detalle: elegida ? `${plan.detalle} Eligió ponerla en «${elegida.ruta}».` : plan.detalle,
      archivoId: a.id,
      fileId: a.fileId,
      version: a.revision,
      ocurrido: momento,
    },
  ];
  let aviso: string | null = null;
  if (plan.siguiente) {
    const r = await avisarRevision(ctx, flujo, [hecho], momento);
    lineas.push(...r.lineas);
    aviso = r.textos[0] ?? `«${plan.siguiente.nombre}» no tiene responsable en este flujo: no se avisó a nadie (solo un administrador puede decidirlo).`;
  } else if (plan.accion === "rechazado") {
    const av = avisoRechazo(hecho, plan.firma, flujo, enlaceDe(ctx.projectId, hecho));
    if (av) {
      const r = await notificar(ctx, a.flujoId, [av], momento, [hecho]);
      lineas.push(...r.lineas);
      aviso = r.textos[0] ?? null;
    } else {
      aviso = "Trimble no dice quién subió esta versión: no se pudo avisar a nadie.";
    }
  }
  // The ToDo of the step just decided is done (when no other file of it still waits).
  lineas.push(...(await cerrarTareas(ctx, [hecho], momento)));
  await ctx.store.registrarVarios(lineas);

  // The last step: the approved version goes now, with the approver's session, to the
  // folder they chose (or to the destination of a flow made before 09-11-2026).
  let traslado: ResultadoTraslado | null = null;
  if (plan.accion === "aprobado" && (flujo.destino || elegida)) {
    traslado = await trasladar(ctx, a.id, { carpetaId: elegida?.id ?? null }).catch((err: unknown) => ({ traslado: null, mensaje: `No se pudo copiar: ${err instanceof Error ? err.message : String(err)}` }));
  }

  const mensaje =
    plan.accion === "rechazado"
      ? `«${a.nombre}» queda rechazado (versión ${a.revision ?? "?"}).`
      : plan.accion === "aprobado"
        ? `«${a.nombre}» queda aprobado (versión ${a.revision ?? "?"}). ${traslado?.mensaje ?? ""}`.trim()
        : `Aprobaste «${plan.firma.paso}» de «${a.nombre}»: pasa a «${plan.siguiente?.nombre}».`;
  return { mensaje: nota ? `${mensaje} Ojo: ${nota}; este flujo no la revisa.` : mensaje, aviso, traslado: traslado?.traslado ?? null };
}

/** "en Trimble ya existe la versión 5" (or "una versión más nueva" when its number isn't known yet). */
export function textoOtraVersion(revision: number | null): string {
  return revision ? `en Trimble ya existe la versión ${revision}` : "en Trimble ya existe una versión más nueva";
}
