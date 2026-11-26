/**
 * "Flujo de aprobación", phase 3: approving and rejecting, and the notices.
 * A decision is about the version the person saw (the flow's own version:
 * since 10-11-2026 a newer one in Trimble doesn't stop it, it is noted in the
 * decision). Two people deciding at once: the second gets "someone decided first".
 * Notices go as the extension's own e-mail (since 19-11-2026 no Trimble ToDo
 * is created or closed); they never block a decision: a failure is noted in
 * the history.
 */
import { buildFileViewerUrl } from "../format";
import type { ProjectUser } from "../trimbleApi";
import { avisoRechazo, avisosRechazo, avisosRevision, FlujoAviso } from "./avisos";
import { configDe, destinatarios, enlaceBoton, enviarCorreos, mensajeErrorCorreo } from "./correo";
import { crearEnlace } from "./enlaces";
import { Decisor, PlanDecision, planDecision, puedeDecidir, revisarTexto } from "./decision";
import { FlujoError } from "./errores";
import type { Ctx } from "./service";
import { chocaConRevision } from "./traslado";
import { carpetaElegida, carpetaParaAprobados, ResultadoTraslado, trasladar } from "./trasladar";
import { responsablesArchivo } from "./registro";
import { MAX_ARCHIVOS } from "./types";
import type { ArchivoRegistro, Aviso, CarpetaFlujo, EntradaHistorial, Flujo, ResultadoVarios, Traslado } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Notices sent per review or decision. */
const MAX_AVISOS = 20;

export const enlaceDe = (projectId: string, a: Pick<ArchivoRegistro, "fileId" | "tipo" | "versionId">) => buildFileViewerUrl(projectId, { id: a.fileId, ext: a.tipo, versionId: a.versionId ?? a.fileId });

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/** What sending a flow's notices did: the history lines, what to tell the person, e-mails sent and notices that didn't go. */
export interface Notificado {
  lineas: Linea[];
  fallidos: number;
  correos: number;
  textos: string[];
}

/**
 * Sends the notices as the extension's own e-mail (11-11-2026; the only notice
 * since 19-11-2026, when the Trimble ToDos were removed), when Vercel has the
 * Gmail account set. «Correos de aviso» (phase 2) says which notices send an
 * e-mail, their texts and who gets a copy. A notice that doesn't go is noted
 * in the history, so nobody thinks the person knows.
 */
export async function notificar(ctx: Ctx, flujoId: string, avisos: Aviso[], momento: string): Promise<Notificado> {
  const lineas: Linea[] = [];
  const textos: string[] = [];
  let fallidos = 0;
  let correos = 0;
  const config = await configDe(ctx);
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
    const correo = ctx.correo;
    const datos = aviso.correo;
    if (correo && datos && config.activo && config.eventos[datos.tipo]) {
      comun ??= { proyecto: (await ctx.tc.nombreProyecto?.().catch(() => "")) || "Trimble Connect", enlace: enlaceBoton(ctx, config) };
      const deTodos = comun;
      // Each person's own link, which opens this flow (phase 3) and keeps who was written to.
      const origen = ctx.origen;
      const enlacePara = origen
        ? (g: { id: string; nombre: string; correo: string | null }) =>
            crearEnlace(
              ctx.store,
              origen,
              { proyecto: ctx.projectId, flujoId, usuarioId: g.id, nombre: g.nombre, correo: g.correo, tipo: datos.tipo, archivos: aviso.archivos, pasoId: aviso.pasoId ?? null, proyectoNombre: deTodos.proyecto },
              new Date(momento)
            )
        : undefined;
      const c = await destinatarios(aviso.para, personas, (g) => ctx.tc.miembros(g).catch(() => []))
        .then((gente) => enviarCorreos(correo, datos, gente, deTodos, { plantilla: config.textos[datos.tipo], copia: config.copia, enlacePara }))
        .catch((err: unknown) => ({ ok: false, enviados: 0, mensaje: `No se pudo enviar el correo: ${mensajeErrorCorreo(err)}.` }));
      correos += c.enviados;
      if (!c.ok) fallidos++;
      lineas.push(linea(c.ok ? "correo-enviado" : "correo-fallido", c.mensaje));
      textos.push(c.mensaje);
    } else {
      // No e-mail: noted, so nobody thinks the person knows.
      const quienes = aviso.para.map((p) => p.nombre + (p.tipo === "grupo" ? " (grupo)" : "")).join(", ");
      const porque = !correo
        ? "no hay cuenta de Gmail en Vercel para enviar los correos"
        : !config.activo
          ? "los correos están apagados en «Correos de aviso»"
          : "este aviso está apagado en «Correos de aviso»";
      const texto = `No se avisó a ${quienes} («${aviso.titulo}»): ${porque}.`;
      fallidos++;
      lineas.push(linea("aviso-fallido", texto));
      textos.push(texto);
    }
  }
  return { lineas, fallidos, correos, textos };
}

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** « Se avisó a los revisores con 2 correos. 1 aviso no se pudo enviar (ver Historial).» */
export function resumenAvisos(r: Pick<Notificado, "fallidos" | "correos">, aQuien = ""): string {
  return [
    r.correos ? ` Se avisó${aQuien ? ` ${aQuien}` : ""} con ${contar(r.correos, "correo", "correos")}.` : "",
    r.fallidos ? ` ${contar(r.fallidos, "aviso no se pudo enviar", "avisos no se pudieron enviar")} (ver Historial).` : "",
  ].join("");
}

/** The notices for a flow's files that now wait for someone (new, new version, next step). */
export async function avisarRevision(ctx: Ctx, flujo: Pick<Flujo, "id"> & FlujoAviso, archivos: ArchivoRegistro[], momento: string): Promise<Notificado> {
  if (!archivos.length) return { lineas: [], fallidos: 0, correos: 0, textos: [] };
  const avisos = avisosRevision(archivos, flujo, (a) => enlaceDe(ctx.projectId, a));
  return notificar(ctx, flujo.id, avisos, momento);
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
  const decisor = await decisorDe(ctx, [a], flujo);
  const puede = puedeDecidir(a, flujo, decisor);
  if (puede.error) throw new FlujoError(puede.error, 403, "sin-permiso");

  // The folder the responsible chose for the approved version.
  let elegida: CarpetaFlujo | null = null;
  if (typeof o.destino === "string" && o.destino) {
    if (decision !== "aprobar" || a.pasoActual !== a.pasos.length - 1) throw new FlujoError("La carpeta se elige al aprobar el último paso.");
    if (flujo.destino) throw new FlujoError(`Este flujo copia lo aprobado a su carpeta destino («${flujo.destino.ruta}»).`);
    elegida = await carpetaElegida(ctx, a, o.destino);
  }

  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  const { hecho, plan, nota, linea } = await aplicarDecision(ctx, a, decision, decisor, puede.comoAdmin, texto.texto, elegida, momento);
  const lineas: Linea[] = [linea];
  let aviso: string | null = null;
  if (plan.siguiente) {
    const r = await avisarRevision(ctx, flujo, [hecho], momento);
    lineas.push(...r.lineas);
    aviso = r.textos[0] ?? `«${plan.siguiente.nombre}» no tiene responsable en este flujo: no se avisó a nadie (solo un administrador puede decidirlo).`;
  } else if (plan.accion === "rechazado") {
    const av = avisoRechazo(hecho, plan.firma, flujo, enlaceDe(ctx.projectId, hecho));
    if (av) {
      const r = await notificar(ctx, a.flujoId, [av], momento);
      lineas.push(...r.lineas);
      aviso = r.textos[0] ?? null;
    } else {
      aviso = "Trimble no dice quién subió esta versión: no se pudo avisar a nadie.";
    }
  }
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

/** Who decides, with the groups (among these files' responsibles) they belong to. */
async function decisorDe(ctx: Ctx, archivos: ArchivoRegistro[], flujo: Flujo): Promise<Decisor> {
  const grupos = [...new Set(archivos.flatMap((a) => responsablesArchivo(a, flujo)).filter((r) => r.tipo === "grupo").map((r) => r.id))];
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  return { id: ctx.caller.id, nombre: ctx.caller.name, esAdmin: ctx.caller.isAdmin, grupos: mios };
}

/**
 * One file's decision once its checks passed: notes a newer version in Trimble
 * (the flow keeps its own, so it is clear what was decided), writes it only if
 * nobody decided first, and returns its history line.
 */
async function aplicarDecision(
  ctx: Ctx,
  a: ArchivoRegistro,
  decision: "aprobar" | "rechazar",
  decisor: Decisor,
  comoAdmin: boolean,
  texto: string,
  elegida: CarpetaFlujo | null,
  momento: string
): Promise<{ hecho: ArchivoRegistro; plan: PlanDecision; nota: string; linea: Linea }> {
  const enTrimble = await ctx.tc.version(a.fileId).catch(() => null);
  const hayOtra = enTrimble ? enTrimble !== a.versionId : !!a.versionNueva;
  const conocida = a.versionNueva && (!enTrimble || a.versionNueva.versionId === enTrimble) ? a.versionNueva.revision : null;
  const nota = hayOtra ? textoOtraVersion(conocida) : "";
  const base = planDecision(a, decision, decisor, comoAdmin, texto, momento);
  const plan = nota ? { ...base, detalle: `${base.detalle.replace(/\.?$/, ".")} Ojo: ${nota}.` } : base;
  const hecho = await ctx.store.decidirArchivo(a.id, { versionId: a.versionId, pasoActual: a.pasoActual, estado: a.estado }, plan.cambios);
  if (!hecho) throw new FlujoError("Otra persona decidió sobre este archivo, o llegó una versión nueva, hace un momento: recarga para verlo.", 409, "ya-decidido");
  const linea: Linea = {
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
  };
  return { hecho, plan, nota, linea };
}

/** Files decided at the same time (each one asks Trimble for its latest version). */
const PARALELO_VARIOS = 6;

/**
 * { flujoId, archivos: [{ archivoId, versionId }], texto, destino? }: approves
 * or rejects several files of one flow at once (the panel's selection,
 * 26-11-2026), with one comment or reason for all. Each file is checked as when
 * deciding it alone (its turn, the version seen, nobody decided first); one
 * that can't be decided doesn't stop the others. `destino`: the folder, chosen
 * once, for the files approved on their last step. The next step's
 * responsibles get one e-mail with the list, and each uploader one with their
 * rejected files. The copies to the folder are asked by the browser afterwards.
 */
export async function decidirVarios(ctx: Ctx, body: unknown, decision: "aprobar" | "rechazar"): Promise<ResultadoVarios> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.flujoId !== "string" || !UUID.test(o.flujoId)) throw new FlujoError("El flujo no es válido.");
  if (!Array.isArray(o.archivos) || !o.archivos.length) throw new FlujoError("Elige los archivos.");
  if (o.archivos.length > MAX_ARCHIVOS) throw new FlujoError(`Se deciden hasta ${MAX_ARCHIVOS} archivos a la vez.`);
  const pedidos = new Map<string, string | null>();
  for (const x of o.archivos) {
    const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof p.archivoId !== "string" || !UUID.test(p.archivoId)) throw new FlujoError("Un archivo elegido no es válido.");
    pedidos.set(p.archivoId, typeof p.versionId === "string" ? p.versionId : null);
  }
  const texto = revisarTexto(decision, o.texto);
  if (texto.error) throw new FlujoError(texto.error);
  const flujo = await ctx.store.flujo(o.flujoId);
  if (!flujo || flujo.proyecto !== ctx.projectId) throw new FlujoError("Ese flujo no existe en este proyecto.", 404);
  const [registrados, flujos] = await Promise.all([ctx.store.archivos(ctx.projectId), ctx.store.flujos(ctx.projectId)]);
  const porId = new Map(registrados.map((a) => [a.id, a]));
  const elegidos = [...pedidos.keys()].map((id) => porId.get(id)).filter((a): a is ArchivoRegistro => !!a && a.flujoId === flujo.id);

  // The folder, read once, for what is approved on its last step.
  let carpeta: CarpetaFlujo | null = null;
  if (typeof o.destino === "string" && o.destino) {
    if (decision !== "aprobar") throw new FlujoError("La carpeta se elige al aprobar el último paso.");
    if (flujo.destino) throw new FlujoError(`Este flujo copia lo aprobado a su carpeta destino («${flujo.destino.ruta}»).`);
    carpeta = await carpetaParaAprobados(ctx, o.destino);
  }

  const decisor = await decisorDe(ctx, elegidos, flujo);
  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  const resultados: ResultadoVarios["resultados"] = [];
  const hechos: { hecho: ArchivoRegistro; plan: PlanDecision; elegida: CarpetaFlujo | null }[] = [];
  const lineas: Linea[] = [];
  const ids = [...pedidos.keys()];
  for (let i = 0; i < ids.length; i += PARALELO_VARIOS) {
    await Promise.all(
      ids.slice(i, i + PARALELO_VARIOS).map(async (id) => {
        const a = porId.get(id);
        const no = (nombre: string, t: string) => void resultados.push({ archivoId: id, nombre, ok: false, texto: t });
        if (!a || a.flujoId !== flujo.id) return no("—", "Ese archivo no está en este flujo.");
        if (pedidos.get(id) !== a.versionId) return no(a.nombre, `Llegó la versión ${a.revision ?? "nueva"} después de que lo abriste: revísala antes de decidir.`);
        const puede = puedeDecidir(a, flujo, decisor);
        if (puede.error) return no(a.nombre, puede.error);
        let elegida: CarpetaFlujo | null = null;
        if (carpeta && a.pasoActual === a.pasos.length - 1) {
          const choca = chocaConRevision(a, carpeta, registrados, flujos);
          if (choca) return no(a.nombre, choca);
          elegida = carpeta;
        }
        try {
          const r = await aplicarDecision(ctx, a, decision, decisor, puede.comoAdmin, texto.texto, elegida, momento);
          lineas.push(r.linea);
          hechos.push({ hecho: r.hecho, plan: r.plan, elegida });
          const que = r.plan.accion === "rechazado" ? "Rechazado." : r.plan.accion === "aprobado" ? "Aprobado." : `Pasa a «${r.plan.siguiente?.nombre}».`;
          resultados.push({ archivoId: id, nombre: a.nombre, ok: true, texto: r.nota ? `${que} Ojo: ${r.nota}.` : que });
        } catch (err) {
          no(a.nombre, err instanceof Error ? err.message : String(err));
        }
      })
    );
  }

  // The notices: one per group of files that now wait for the same people, and one per uploader of what was rejected.
  const avisos: string[] = [];
  const siguen = hechos.filter((h) => h.plan.siguiente).map((h) => h.hecho);
  if (siguen.length) {
    const r = await avisarRevision(ctx, flujo, siguen, momento);
    lineas.push(...r.lineas);
    avisos.push(...r.textos);
    const sinResp = siguen.filter((a) => !responsablesArchivo(a, flujo).length).length;
    if (sinResp) avisos.push(`${contar(sinResp, "archivo pasa", "archivos pasan")} a un paso sin responsable: no se avisó a nadie (solo un administrador puede decidirlo).`);
  }
  const rechazados = hechos.filter((h) => h.plan.accion === "rechazado").map((h) => ({ a: h.hecho, firma: h.plan.firma }));
  if (rechazados.length) {
    const { avisos: av, sinQuien } = avisosRechazo(rechazados, flujo, (a) => enlaceDe(ctx.projectId, a));
    if (av.length) {
      const r = await notificar(ctx, flujo.id, av, momento);
      lineas.push(...r.lineas);
      avisos.push(...r.textos);
    }
    if (sinQuien) avisos.push(`Trimble no dice quién subió ${contar(sinQuien, "archivo rechazado", "archivos rechazados")}: no se pudo avisar a nadie.`);
  }
  await ctx.store.registrarVarios(lineas);

  const copiar = hechos
    .filter((h) => h.plan.accion === "aprobado" && (flujo.destino || h.elegida))
    .map((h) => ({ archivoId: h.hecho.id, nombre: h.hecho.nombre, carpetaId: h.elegida?.id ?? null }));
  const orden = new Map(ids.map((id, i) => [id, i]));
  resultados.sort((p, q) => (orden.get(p.archivoId) ?? 0) - (orden.get(q.archivoId) ?? 0));
  return { mensaje: mensajeVarios(decision, hechos.map((h) => h.plan.accion), resultados.filter((r) => !r.ok).length), resultados, avisos, copiar };
}

/** «3 archivos pasan al paso siguiente, 2 archivos quedan aprobados. 1 archivo no se pudo decidir (abajo el motivo).» */
export function mensajeVarios(decision: "aprobar" | "rechazar", acciones: PlanDecision["accion"][], fallidos: number): string {
  const n = (a: PlanDecision["accion"]) => acciones.filter((x) => x === a).length;
  const partes =
    decision === "rechazar"
      ? [n("rechazado") ? contar(n("rechazado"), "archivo queda rechazado", "archivos quedan rechazados") : ""]
      : [n("aprobado-paso") ? `${contar(n("aprobado-paso"), "archivo pasa", "archivos pasan")} al paso siguiente` : "", n("aprobado") ? contar(n("aprobado"), "archivo queda aprobado", "archivos quedan aprobados") : ""];
  const hecho = partes.filter(Boolean).join(", ");
  const mal = fallidos ? ` ${contar(fallidos, "archivo no se pudo decidir", "archivos no se pudieron decidir")} (abajo el motivo).` : "";
  return `${hecho ? `${hecho.charAt(0).toUpperCase()}${hecho.slice(1)}.` : "No se decidió ningún archivo."}${mal}`;
}

/** "en Trimble ya existe la versión 5" (or "una versión más nueva" when its number isn't known yet). */
export function textoOtraVersion(revision: number | null): string {
  return revision ? `en Trimble ya existe la versión ${revision}` : "en Trimble ya existe una versión más nueva";
}
