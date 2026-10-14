// The assistant's rules: who uses it (the budget's editors), who sets its
// quota (the administrators of the platform's "gestor" project), what each
// call costs, and drafts that only reach the budget when a person accepts them.
import { ServiceError } from "../../propiedades/service";
import { Ctx, requireEdit, puedeEditar } from "../service";
import { errorDeIA, MODELO_POR_DEFECTO, RespuestaIA } from "./claude";
import { aCop, costoUsd, disponibleCop, estadoCupo, estimarCostoCop, fmtCop, globalPorDefecto, inicioDeMes } from "./cupo";
import { ESQUEMA_EDT, leerRespuestaEdt, maxTokensEdt, mensajeEdt, SISTEMA_EDT, VERSION_PROMPT_EDT } from "./edt";
import {
  BorradorIA,
  CupoGlobalIA,
  CupoIA,
  EstadoCupo,
  EstadoIAResponse,
  GenerarEdtResponse,
  MAX_CONTEXTO_IA,
  MAX_PARTIDAS_LOTE_IA,
  MAX_TEXTO_EDT_IA,
  PartidaEdtIA,
  RegistroUsoIA,
  ResumenBorradores,
} from "./tipos";

const GLOBAL = "_global";
/** Short texts per partida: low effort keeps each batch quick (the acceptance rate tells if it is enough). */
const ESFUERZO_EDT = "low";
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DECISIONES = 500;

function bad(message: string): never {
  throw new ServiceError(message, 400);
}

/** The defaults (and the exchange rate) for projects without their own quota. */
async function cupoGlobal(ctx: Ctx): Promise<CupoGlobalIA> {
  const g = await ctx.store.getCupoIA(GLOBAL);
  const def = globalPorDefecto();
  if (!g) return def;
  return { habilitada: g.habilitada, cupoProyectoCop: g.cupoProyectoCop, cupoUsuarioCop: g.cupoUsuarioCop, trm: g.trm && g.trm > 0 ? g.trm : def.trm };
}

/** Administrators of the "gestor" project (PRESUPUESTO_IA_PROYECTO_GESTOR) manage the quotas. */
export async function esGestorIA(ctx: Ctx): Promise<boolean> {
  const gestor = ctx.deps.iaGestor;
  if (!gestor) return false;
  if (gestor === ctx.projectId) return ctx.caller.isAdmin;
  try {
    return (await ctx.deps.callerIn(gestor)).isAdmin;
  } catch {
    return false;
  }
}

async function cupoActual(ctx: Ctx): Promise<EstadoCupo> {
  const [propio, global] = await Promise.all([ctx.store.getCupoIA(ctx.projectId), cupoGlobal(ctx)]);
  const mes = inicioDeMes(ctx.deps.ahora?.() ?? new Date());
  const gasto = await ctx.store.gastoIA(ctx.projectId, mes.desde, ctx.caller.id);
  return estadoCupo(propio, global, gasto, mes.fecha);
}

export async function getEstadoIA(ctx: Ctx): Promise<EstadoIAResponse> {
  const [puedeUsar, puedeAdministrar] = await Promise.all([puedeEditar(ctx), esGestorIA(ctx)]);
  const cliente = ctx.deps.ia?.() ?? null;
  const ve = puedeUsar || puedeAdministrar;
  const [cupo, usos, resumen, global] = await Promise.all([
    cupoActual(ctx),
    ve ? ctx.store.usosIA(ctx.projectId, 50) : Promise.resolve([] as RegistroUsoIA[]),
    ve ? ctx.store.resumenBorradoresIA(ctx.projectId) : Promise.resolve<ResumenBorradores>({ pendientes: 0, aceptadosSinCambios: 0, aceptadosEditados: 0, rechazados: 0 }),
    puedeAdministrar ? cupoGlobal(ctx) : Promise.resolve(null),
  ]);
  return {
    disponible: !!cliente,
    modelo: cliente?.modelo ?? MODELO_POR_DEFECTO,
    puedeUsar,
    puedeAdministrar,
    gestorConfigurado: !!ctx.deps.iaGestor,
    cupo,
    global,
    usos,
    resumen,
  };
}

function pesos(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) bad(`${what}: se esperaba un valor en pesos mayor o igual a 0.`);
  if (value > 10_000_000_000) bad(`${what}: el valor es demasiado grande.`);
  return Math.round(value * 100) / 100;
}

function validarCupo(value: unknown, what: string): CupoIA {
  const o = (value ?? {}) as Record<string, unknown>;
  if (typeof o.habilitada !== "boolean") bad(`${what}: falta si está habilitado.`);
  return { habilitada: o.habilitada, cupoProyectoCop: pesos(o.cupoProyectoCop, `${what}: cupo del proyecto`), cupoUsuarioCop: pesos(o.cupoUsuarioCop, `${what}: cupo por persona`) };
}

/** { proyecto?: CupoIA, global?: CupoGlobalIA }: only the platform's administrators. */
export async function guardarCupoIA(ctx: Ctx, body: unknown): Promise<EstadoIAResponse> {
  if (!(await esGestorIA(ctx))) {
    throw new ServiceError("Solo los administradores de la plataforma (proyecto gestor) cambian los cupos del asistente IA.", 403, "not-ia-admin");
  }
  const o = (body ?? {}) as { proyecto?: unknown; global?: unknown };
  if (o.proyecto === undefined && o.global === undefined) bad("No hay cambios de cupo.");
  if (o.global !== undefined) {
    const g = validarCupo(o.global, "Valores por defecto");
    const trm = (o.global as { trm?: unknown }).trm;
    if (typeof trm !== "number" || !Number.isFinite(trm) || trm < 100 || trm > 100_000) bad("TRM: se esperaban los pesos por dólar (entre 100 y 100.000).");
    await ctx.store.saveCupoIA(GLOBAL, { ...g, trm: Math.round(trm * 100) / 100 }, ctx.caller.name);
  }
  if (o.proyecto !== undefined) await ctx.store.saveCupoIA(ctx.projectId, validarCupo(o.proyecto, "Cupo del proyecto"), ctx.caller.name);
  return getEstadoIA(ctx);
}

function texto(value: unknown, what: string, max: number, required = false): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") bad(`${what}: se esperaba texto.`);
  const t = value.trim();
  if (required && !t) bad(`${what} es obligatorio.`);
  if (t.length > max) bad(`${what}: máximo ${max} caracteres.`);
  return t;
}

function validarPeticionEdt(body: unknown): { contexto: string; partidas: PartidaEdtIA[] } {
  const o = (body ?? {}) as { contexto?: unknown; partidas?: unknown };
  const contexto = texto(o.contexto, "Contexto del proyecto", MAX_CONTEXTO_IA);
  if (!Array.isArray(o.partidas) || o.partidas.length === 0) bad("No hay partidas para enviar.");
  if (o.partidas.length > MAX_PARTIDAS_LOTE_IA) bad(`Máximo ${MAX_PARTIDAS_LOTE_IA} partidas por lote.`);
  const ids = new Set<string>();
  const partidas = o.partidas.map((v, i): PartidaEdtIA => {
    const p = (v ?? {}) as Record<string, unknown>;
    const what = `Partida ${i + 1}`;
    if (typeof p.id !== "string" || !ID_RE.test(p.id)) bad(`${what}: id no válido.`);
    if (ids.has(p.id)) bad(`${what}: está repetida.`);
    ids.add(p.id);
    const a = p.actual as { descripcion?: unknown; criterios?: unknown } | null | undefined;
    return {
      id: p.id,
      item: texto(p.item, `${what}: item`, 40),
      descripcion: texto(p.descripcion, `${what}: descripción`, 300, true),
      unidad: texto(p.unidad, `${what}: unidad`, 40),
      capitulo: texto(p.capitulo, `${what}: capítulo`, 400),
      omniclass: texto(p.omniclass, `${what}: OmniClass`, 40),
      actual: a ? { descripcion: texto(a.descripcion, `${what}: descripción actual`, MAX_TEXTO_EDT_IA), criterios: texto(a.criterios, `${what}: criterios actuales`, MAX_TEXTO_EDT_IA) } : null,
    };
  });
  return { contexto, partidas };
}

/** Logs a call (also the failed ones, which may have cost something). */
async function registrar(
  ctx: Ctx,
  r: { modelo: string; items: number; respuesta: RespuestaIA | null; trm: number; estado: RegistroUsoIA["estado"]; detalle: string }
): Promise<{ id: number; costoCop: number }> {
  const tokens = r.respuesta?.tokens ?? [];
  const usd = costoUsd(tokens);
  const costoCop = aCop(usd, r.trm);
  const suma = (k: "entrada" | "salida" | "cacheEscritura" | "cacheLectura") => tokens.reduce((s, t) => s + t[k], 0);
  const id = await ctx.store.registrarUsoIA({
    projectId: ctx.projectId,
    userId: ctx.caller.id,
    userName: ctx.caller.name,
    tarea: "edt",
    modelo: r.respuesta?.modelo ?? r.modelo,
    items: r.items,
    tokensEntrada: suma("entrada"),
    tokensSalida: suma("salida"),
    tokensCacheEscritura: suma("cacheEscritura"),
    tokensCacheLectura: suma("cacheLectura"),
    costoUsd: usd,
    trm: r.trm,
    costoCop,
    versionPrompt: VERSION_PROMPT_EDT,
    estado: r.estado,
    detalle: r.detalle,
  });
  return { id, costoCop };
}

/**
 * Proposes the EDT dictionary (work description and acceptance criteria) of
 * a batch of partidas. The proposals are saved as drafts for review.
 */
export async function generarEdtIA(ctx: Ctx, body: unknown): Promise<GenerarEdtResponse> {
  await requireEdit(ctx);
  const cliente = ctx.deps.ia?.() ?? null;
  if (!cliente) {
    throw new ServiceError("El asistente IA no está configurado: falta la variable ANTHROPIC_API_KEY en Vercel.", 503, "ia-sin-clave");
  }
  const { contexto, partidas } = validarPeticionEdt(body);
  const cupo = await cupoActual(ctx);
  if (cupo.nivel === "deshabilitada" || cupo.nivel === "agotado") throw new ServiceError(cupo.mensaje, 402, "ia-cupo");

  const usuario = mensajeEdt(contexto, partidas);
  const maxTokens = maxTokensEdt(partidas.length);
  const tope = estimarCostoCop(cliente.modelo, SISTEMA_EDT.length + usuario.length, maxTokens, cupo.trm);
  const queda = disponibleCop(cupo);
  if (tope > queda) {
    throw new ServiceError(
      `Este lote puede costar hasta ${fmtCop(tope)} y quedan ${fmtCop(queda)} de cupo este mes. Envía menos partidas por lote o pide más cupo.`,
      402,
      "ia-cupo"
    );
  }

  const base = { modelo: cliente.modelo, items: partidas.length, trm: cupo.trm };
  let respuesta: RespuestaIA;
  try {
    respuesta = await cliente.generar({ sistema: SISTEMA_EDT, usuario, esquema: ESQUEMA_EDT, maxTokens, esfuerzo: ESFUERZO_EDT });
  } catch (err) {
    const e = err instanceof ServiceError ? err : errorDeIA(err);
    await registrar(ctx, { ...base, respuesta: null, estado: "error", detalle: e.message });
    throw e;
  }
  if (respuesta.stopReason === "refusal") {
    await registrar(ctx, { ...base, respuesta, estado: "rechazado", detalle: `Rechazo: ${respuesta.rechazo}` });
    throw new ServiceError("La IA no respondió este lote por sus filtros de seguridad. Revisa el texto de esas partidas o envía otras.", 422, "ia-rechazo");
  }
  if (respuesta.stopReason === "max_tokens") {
    await registrar(ctx, { ...base, respuesta, estado: "incompleto", detalle: "La respuesta superó el máximo de tokens." });
    throw new ServiceError("La respuesta de la IA quedó incompleta. Envía menos partidas por lote.", 502, "ia-incompleto");
  }
  let leida: ReturnType<typeof leerRespuestaEdt>;
  try {
    leida = leerRespuestaEdt(respuesta.texto ?? "", partidas);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Respuesta no válida.";
    await registrar(ctx, { ...base, respuesta, estado: "error", detalle: mensaje });
    throw new ServiceError(`${mensaje} Intenta de nuevo.`, 502, "ia-respuesta");
  }

  const uso = await registrar(ctx, { ...base, respuesta, estado: "ok", detalle: `${leida.propuestas.size} de ${partidas.length} propuestas` });
  const ahora = new Date().toISOString();
  const porId = new Map(partidas.map((p) => [p.id, p]));
  const borradores: BorradorIA[] = [...leida.propuestas].map(([itemId, propuesta]) => {
    const p = porId.get(itemId)!;
    return {
      id: globalThis.crypto.randomUUID(),
      tarea: "edt",
      itemId,
      referencia: `${p.item} ${p.descripcion}`.slice(0, 300),
      propuesta,
      anterior: p.actual,
      estado: "pendiente",
      editado: false,
      final: null,
      usoId: uso.id,
      creado: ahora,
      creadoPor: ctx.caller.name,
      decidido: null,
      decididoPor: null,
    };
  });
  await ctx.store.guardarBorradoresIA(ctx.projectId, borradores);
  return { borradores, faltantes: leida.faltantes, costoCop: uso.costoCop, cupo: await cupoActual(ctx) };
}

/** The drafts waiting for review. */
export async function listarBorradoresIA(ctx: Ctx): Promise<{ borradores: BorradorIA[] }> {
  await requireEdit(ctx);
  return { borradores: await ctx.store.borradoresIA(ctx.projectId, { estado: "pendiente", tarea: "edt" }) };
}

/**
 * { decisiones: [{ id, estado: "aceptado" | "rechazado", final?: { descripcion, criterios } }] }.
 * The budget itself changes in the browser (and is saved as always); this
 * records what was accepted, edited or rejected.
 */
export async function decidirBorradoresIA(ctx: Ctx, body: unknown): Promise<{ decididos: number; resumen: ResumenBorradores }> {
  await requireEdit(ctx);
  const lista = (body as { decisiones?: unknown } | null)?.decisiones;
  if (!Array.isArray(lista) || lista.length === 0) bad("No hay decisiones.");
  if (lista.length > MAX_DECISIONES) bad(`Máximo ${MAX_DECISIONES} decisiones por envío.`);
  const pedidas = lista.map((v, i) => {
    const d = (v ?? {}) as Record<string, unknown>;
    if (typeof d.id !== "string" || !UUID_RE.test(d.id)) bad(`Decisión ${i + 1}: id no válido.`);
    if (d.estado !== "aceptado" && d.estado !== "rechazado") bad(`Decisión ${i + 1}: debe ser aceptado o rechazado.`);
    const f = d.final as { descripcion?: unknown; criterios?: unknown } | undefined;
    const final = f
      ? { descripcion: texto(f.descripcion, `Decisión ${i + 1}: descripción`, MAX_TEXTO_EDT_IA), criterios: texto(f.criterios, `Decisión ${i + 1}: criterios`, MAX_TEXTO_EDT_IA) }
      : null;
    return { id: d.id, estado: d.estado as "aceptado" | "rechazado", final };
  });
  const borradores = new Map((await ctx.store.borradoresIA(ctx.projectId, { estado: "pendiente", ids: pedidas.map((d) => d.id) })).map((b) => [b.id, b]));
  const decisiones = pedidas
    .filter((d) => borradores.has(d.id))
    .map((d) => {
      const b = borradores.get(d.id)!;
      if (d.estado === "rechazado") return { id: d.id, estado: d.estado, editado: false, final: null };
      const final = d.final ?? { descripcion: b.propuesta.descripcion, criterios: b.propuesta.criterios };
      const editado = final.descripcion !== b.propuesta.descripcion || final.criterios !== b.propuesta.criterios;
      return { id: d.id, estado: d.estado, editado, final };
    });
  const decididos = decisiones.length ? await ctx.store.decidirBorradoresIA(ctx.projectId, decisiones, ctx.caller.name) : 0;
  return { decididos, resumen: await ctx.store.resumenBorradoresIA(ctx.projectId) };
}
