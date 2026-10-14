// The assistant's rules: who uses it (the budget's editors), who sets its
// quota (the administrators of the platform's "gestor" project), what each
// call costs, and drafts that only reach the budget when a person accepts them.
import { isValidProjectId } from "../../access";
import { ServiceError } from "../../propiedades/service";
import { plegar } from "../format";
import { Ctx, requireEdit, puedeEditar } from "../service";
import { TipoInsumo, TIPOS_INSUMO } from "../types";
import { errorDeIA, RespuestaIA } from "./claude";
import { aCop, costoUsd, disponibleCop, estadoCupo, estimarCostoCop, fmtCop, globalPorDefecto, inicioDeMes } from "./cupo";
import { ESQUEMA_EDT, leerRespuestaEdt, maxTokensEdt, mensajeEdt, SISTEMA_EDT, VERSION_PROMPT_EDT } from "./edt";
import {
  catalogoPartidasTexto,
  ESQUEMA_CAPITULOS,
  ESQUEMA_PARTIDAS,
  leerCapitulos,
  leerPartidas,
  MAX_CAPITULOS,
  MAX_PARTIDAS_CAPITULO,
  mensajeCapitulos,
  mensajePartidas,
  SISTEMA_CAPITULOS,
  SISTEMA_PARTIDAS,
  VERSION_PROMPT_ESTRUCTURA,
} from "./estructura";
import { catalogoInsumosTexto, ESQUEMA_INSUMOS, leerInsumos, maxTokensInsumos, mensajeInsumos, SISTEMA_INSUMOS, VERSION_PROMPT_INSUMOS } from "./insumos";
import {
  BorradorEstructuraIA,
  BorradorGenerico,
  BorradorIA,
  BorradorInsumoIA,
  CapituloIA,
  CupoGlobalIA,
  CupoIA,
  CupoProyectoIA,
  EstadoCupo,
  EstadoIAResponse,
  GenerarEdtResponse,
  GenerarInsumosResponse,
  InsumoCatalogoIA,
  MAX_CATALOGO_IA,
  MAX_CONTEXTO_IA,
  MAX_PARTIDAS_LOTE_IA,
  MAX_TEXTO_EDT_IA,
  PartidaCatalogoIA,
  PartidaEdtIA,
  PartidaInsumosIA,
  PeticionEstructura,
  PropuestaCapitulo,
  PropuestaInsumo,
  RegistroUsoIA,
  ResumenesIA,
  TareaIA,
} from "./tipos";

type PropuestaEdtFinal = { descripcion: string; criterios: string };

const GLOBAL = "_global";
/** Short answers: low effort keeps each call quick (the acceptance rates tell if it is enough). */
const ESFUERZO = "low";
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
    ve ? ctx.store.resumenBorradoresIA(ctx.projectId) : Promise.resolve<ResumenesIA>({}),
    puedeAdministrar ? cupoGlobal(ctx) : Promise.resolve(null),
  ]);
  const proyectos = puedeAdministrar ? await proyectosConCupo(ctx) : null;
  return {
    disponible: !!cliente,
    proveedor: cliente?.proveedor ?? "",
    modelo: cliente?.modelo ?? "",
    puedeUsar,
    puedeAdministrar,
    gestorConfigurado: !!ctx.deps.iaGestor,
    cupo,
    global,
    proyectos,
    usos,
    resumen,
  };
}

/** Every project with its own quota and what it spent this month. */
async function proyectosConCupo(ctx: Ctx): Promise<CupoProyectoIA[]> {
  const mes = inicioDeMes(ctx.deps.ahora?.() ?? new Date());
  const [cupos, gastos] = await Promise.all([ctx.store.listarCuposIA(), ctx.store.gastoProyectosIA(mes.desde)]);
  return cupos.map((c) => ({
    projectId: c.projectId,
    nombre: c.projectName || c.projectId,
    habilitada: c.habilitada,
    cupoProyectoCop: c.cupoProyectoCop,
    cupoUsuarioCop: c.cupoUsuarioCop,
    gastoMesCop: gastos.get(c.projectId) ?? 0,
    updatedAt: c.updatedAt ?? null,
    updatedBy: c.updatedBy ?? null,
  }));
}

/** "https://web.connect.trimble.com/projects/AbC123/data" or "AbC123" -> "AbC123". */
export function idDeProyecto(text: string): string {
  const t = text.trim();
  const m = /projects\/([A-Za-z0-9_-]{4,64})/.exec(t);
  return m ? m[1] : t;
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

/**
 * { proyecto?: CupoIA, otro?: { proyecto: id or URL, cupo: CupoIA }, global?: CupoGlobalIA }:
 * the quota of this project, of another one, or the defaults. Only the platform's administrators.
 */
export async function guardarCupoIA(ctx: Ctx, body: unknown): Promise<EstadoIAResponse> {
  if (!(await esGestorIA(ctx))) {
    throw new ServiceError("Solo los administradores de la plataforma (proyecto gestor) cambian los cupos del asistente IA.", 403, "not-ia-admin");
  }
  const o = (body ?? {}) as { proyecto?: unknown; global?: unknown; otro?: unknown };
  if (o.proyecto === undefined && o.global === undefined && o.otro === undefined) bad("No hay cambios de cupo.");
  const nombreDe = (id: string) => ctx.deps.projectName(id).catch(() => "");
  if (o.global !== undefined) {
    const g = validarCupo(o.global, "Valores por defecto");
    const trm = (o.global as { trm?: unknown }).trm;
    if (typeof trm !== "number" || !Number.isFinite(trm) || trm < 100 || trm > 100_000) bad("TRM: se esperaban los pesos por dólar (entre 100 y 100.000).");
    await ctx.store.saveCupoIA(GLOBAL, { ...g, trm: Math.round(trm * 100) / 100 }, ctx.caller.name);
  }
  if (o.proyecto !== undefined) {
    const cupo = validarCupo(o.proyecto, "Cupo del proyecto");
    await ctx.store.saveCupoIA(ctx.projectId, { ...cupo, projectName: (await nombreDe(ctx.projectId)) || null }, ctx.caller.name);
  }
  if (o.otro !== undefined) {
    const otro = (o.otro ?? {}) as { proyecto?: unknown; cupo?: unknown };
    const id = typeof otro.proyecto === "string" ? idDeProyecto(otro.proyecto) : "";
    if (!isValidProjectId(id) || id === GLOBAL) bad("Escribe el id del proyecto o pega su dirección de Trimble Connect (la que contiene /projects/...).");
    const cupo = validarCupo(otro.cupo, "Cupo del proyecto");
    await ctx.store.saveCupoIA(id, { ...cupo, projectName: (await nombreDe(id)) || null }, ctx.caller.name);
  }
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

// ---------------------------------------------------------------- one call to the model

interface Llamada<T> {
  tarea: TareaIA;
  version: string;
  sistema: string;
  datosFijos?: string;
  usuario: string;
  esquema: Record<string, unknown>;
  maxTokens: number;
  esfuerzo: "low" | "medium" | "high";
  /** Partidas or chapters it is about (for the log). */
  items: number;
  /** Reads the answer; an error here is logged and reported. */
  leer: (texto: string) => T;
  /** What the log says when it goes well. */
  resumen: (r: T) => string;
}

/** Logs a call (also the failed ones, which may have cost something). */
async function registrar(
  ctx: Ctx,
  r: { tarea: TareaIA; version: string; modelo: string; items: number; respuesta: RespuestaIA | null; trm: number; estado: RegistroUsoIA["estado"]; detalle: string }
): Promise<{ id: number; costoCop: number }> {
  const tokens = r.respuesta?.tokens ?? [];
  const usd = costoUsd(tokens);
  const costoCop = aCop(usd, r.trm);
  const suma = (k: "entrada" | "salida" | "cacheEscritura" | "cacheLectura") => tokens.reduce((s, t) => s + t[k], 0);
  const id = await ctx.store.registrarUsoIA({
    projectId: ctx.projectId,
    userId: ctx.caller.id,
    userName: ctx.caller.name,
    tarea: r.tarea,
    modelo: r.respuesta?.modelo ?? r.modelo,
    items: r.items,
    tokensEntrada: suma("entrada"),
    tokensSalida: suma("salida"),
    tokensCacheEscritura: suma("cacheEscritura"),
    tokensCacheLectura: suma("cacheLectura"),
    costoUsd: usd,
    trm: r.trm,
    costoCop,
    versionPrompt: r.version,
    estado: r.estado,
    detalle: r.detalle,
  });
  return { id, costoCop };
}

/**
 * The common path of every task: permission, key, quota (and the most the
 * call could cost), the call, refusals and cut answers, reading the answer,
 * and the log.
 */
async function llamar<T>(ctx: Ctx, l: Llamada<T>): Promise<{ resultado: T; usoId: number; costoCop: number }> {
  await requireEdit(ctx);
  const cliente = ctx.deps.ia?.() ?? null;
  if (!cliente) {
    throw new ServiceError("El asistente IA no está configurado: falta la clave del proveedor (ANTHROPIC_API_KEY o GEMINI_API_KEY) en Vercel.", 503, "ia-sin-clave");
  }
  const cupo = await cupoActual(ctx);
  if (cupo.nivel === "deshabilitada" || cupo.nivel === "agotado") throw new ServiceError(cupo.mensaje, 402, "ia-cupo");
  const tope = estimarCostoCop(cliente.modelo, l.sistema.length + (l.datosFijos?.length ?? 0) + l.usuario.length, l.maxTokens, cupo.trm);
  const queda = disponibleCop(cupo);
  if (tope > queda) {
    throw new ServiceError(
      `Esta solicitud puede costar hasta ${fmtCop(tope)} y quedan ${fmtCop(queda)} de cupo este mes. Envía menos partidas por lote o pide más cupo.`,
      402,
      "ia-cupo"
    );
  }

  const base = { tarea: l.tarea, version: l.version, modelo: cliente.modelo, items: l.items, trm: cupo.trm };
  let respuesta: RespuestaIA;
  try {
    respuesta = await cliente.generar({ sistema: l.sistema, datosFijos: l.datosFijos, usuario: l.usuario, esquema: l.esquema, maxTokens: l.maxTokens, esfuerzo: l.esfuerzo });
  } catch (err) {
    const e = err instanceof ServiceError ? err : errorDeIA(err);
    await registrar(ctx, { ...base, respuesta: null, estado: "error", detalle: e.message });
    throw e;
  }
  if (respuesta.stopReason === "refusal") {
    await registrar(ctx, { ...base, respuesta, estado: "rechazado", detalle: `Rechazo: ${respuesta.rechazo}` });
    throw new ServiceError("La IA no respondió esta solicitud por sus filtros de seguridad. Revisa el texto enviado o intenta con otro.", 422, "ia-rechazo");
  }
  if (respuesta.stopReason === "max_tokens") {
    await registrar(ctx, { ...base, respuesta, estado: "incompleto", detalle: "La respuesta superó el máximo de tokens." });
    throw new ServiceError("La respuesta de la IA quedó incompleta. Envía menos partidas por lote o elige menos detalle.", 502, "ia-incompleto");
  }
  let resultado: T;
  try {
    resultado = l.leer(respuesta.texto ?? "");
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Respuesta no válida.";
    await registrar(ctx, { ...base, respuesta, estado: "error", detalle: mensaje });
    throw new ServiceError(`${mensaje} Intenta de nuevo.`, 502, "ia-respuesta");
  }
  const uso = await registrar(ctx, { ...base, respuesta, estado: "ok", detalle: l.resumen(resultado) });
  return { resultado, usoId: uso.id, costoCop: uso.costoCop };
}

function nuevoBorrador<B extends BorradorGenerico>(ctx: Ctx, b: Pick<B, "tarea" | "itemId" | "referencia" | "propuesta" | "anterior"> & { usoId: number }): B {
  return {
    id: globalThis.crypto.randomUUID(),
    ...b,
    referencia: b.referencia.slice(0, 300),
    estado: "pendiente",
    editado: false,
    final: null,
    creado: new Date().toISOString(),
    creadoPor: ctx.caller.name,
    decidido: null,
    decididoPor: null,
  } as unknown as B;
}

// ---------------------------------------------------------------- phase 1: the EDT dictionary

/**
 * Proposes the EDT dictionary (work description and acceptance criteria) of
 * a batch of partidas. The proposals are saved as drafts for review.
 */
export async function generarEdtIA(ctx: Ctx, body: unknown): Promise<GenerarEdtResponse> {
  await requireEdit(ctx);
  const { contexto, partidas } = validarPeticionEdt(body);
  const { resultado: leida, usoId, costoCop } = await llamar(ctx, {
    tarea: "edt",
    version: VERSION_PROMPT_EDT,
    sistema: SISTEMA_EDT,
    usuario: mensajeEdt(contexto, partidas),
    esquema: ESQUEMA_EDT,
    maxTokens: maxTokensEdt(partidas.length),
    esfuerzo: ESFUERZO,
    items: partidas.length,
    leer: (texto) => leerRespuestaEdt(texto, partidas),
    resumen: (r) => `${r.propuestas.size} de ${partidas.length} propuestas`,
  });
  const porId = new Map(partidas.map((p) => [p.id, p]));
  const borradores = [...leida.propuestas].map(([itemId, propuesta]) => {
    const p = porId.get(itemId)!;
    return nuevoBorrador<BorradorIA>(ctx, { tarea: "edt", itemId, referencia: `${p.item} ${p.descripcion}`, propuesta, anterior: p.actual, usoId });
  });
  await ctx.store.guardarBorradoresIA(ctx.projectId, borradores);
  return { borradores, faltantes: leida.faltantes, costoCop, cupo: await cupoActual(ctx) };
}

// ---------------------------------------------------------------- phase 3: the EDT from the description

function validarEstructura(body: unknown): PeticionEstructura {
  const o = (body ?? {}) as Record<string, unknown>;
  const descripcion = texto(o.descripcion, "Descripción del proyecto", MAX_CONTEXTO_IA, true);
  if (descripcion.length < 15) bad("Describe el proyecto con un poco más de detalle (tipo de obra, pisos, usos, áreas...).");
  const agrupacion = o.agrupacion === "pisos" ? "pisos" : "capitulos";
  const detalle = o.detalle === "detallado" ? "detallado" : "resumido";
  return { descripcion, agrupacion, detalle };
}

/** Phase 3, step 1: the chapters of the EDT of the described project. */
export async function proponerCapitulosIA(ctx: Ctx, body: unknown): Promise<{ capitulos: CapituloIA[]; costoCop: number; cupo: EstadoCupo }> {
  const pedido = validarEstructura(body);
  const { resultado, costoCop } = await llamar(ctx, {
    tarea: "estructura",
    version: VERSION_PROMPT_ESTRUCTURA,
    sistema: SISTEMA_CAPITULOS,
    usuario: mensajeCapitulos(pedido),
    esquema: ESQUEMA_CAPITULOS,
    maxTokens: 6000,
    esfuerzo: ESFUERZO,
    items: 0,
    leer: (t) => leerCapitulos(t, pedido.agrupacion),
    resumen: (r) => `${r.length} capítulos propuestos`,
  });
  return { capitulos: resultado, costoCop, cupo: await cupoActual(ctx) };
}

function validarCatalogo<T>(value: unknown, what: string, una: (o: Record<string, unknown>, i: number) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(`${what}: se esperaba una lista.`);
  if (value.length > MAX_CATALOGO_IA) bad(`${what}: máximo ${MAX_CATALOGO_IA}.`);
  return value.map((v, i) => una((v ?? {}) as Record<string, unknown>, i));
}

function idValido(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) bad(`${what}: id no válido.`);
  return value;
}

/** Phase 3, step 2: the partidas of one chapter, preferring the catalog's; saved as a draft. */
export async function proponerPartidasIA(ctx: Ctx, body: unknown): Promise<{ borrador: BorradorEstructuraIA; costoCop: number; cupo: EstadoCupo }> {
  const pedido = validarEstructura(body);
  const o = (body ?? {}) as Record<string, unknown>;
  const c = (o.capitulo ?? {}) as Record<string, unknown>;
  const capitulo: CapituloIA = {
    titulo: texto(c.titulo, "Capítulo", 120, true).toUpperCase(),
    alcance: texto(c.alcance, "Alcance del capítulo", 300),
    porPiso: pedido.agrupacion === "pisos" && c.porPiso === true,
  };
  const otros = Array.isArray(o.otros) ? o.otros.filter((x): x is string => typeof x === "string").slice(0, MAX_CAPITULOS).map((x) => x.slice(0, 120)) : [];
  const catalogo = validarCatalogo<PartidaCatalogoIA>(o.catalogo, "Catálogo de partidas", (p, i) => ({
    id: idValido(p.id, `Partida del catálogo ${i + 1}`),
    descripcion: texto(p.descripcion, `Partida del catálogo ${i + 1}`, 300, true),
    unidad: texto(p.unidad, `Unidad de la partida del catálogo ${i + 1}`, 20),
  }));
  const { resultado: partidas, usoId, costoCop } = await llamar(ctx, {
    tarea: "estructura",
    version: VERSION_PROMPT_ESTRUCTURA,
    sistema: SISTEMA_PARTIDAS,
    datosFijos: catalogoPartidasTexto(catalogo),
    usuario: mensajePartidas(pedido, capitulo, otros),
    esquema: ESQUEMA_PARTIDAS,
    maxTokens: pedido.detalle === "detallado" ? 8000 : 5000,
    esfuerzo: ESFUERZO,
    items: 1,
    leer: (t) => leerPartidas(t, catalogo),
    resumen: (r) => `${capitulo.titulo}: ${r.length} partidas (${r.filter((x) => x.catalogoId).length} del catálogo)`,
  });
  const borrador = nuevoBorrador<BorradorEstructuraIA>(ctx, {
    tarea: "estructura",
    itemId: `cap:${plegar(capitulo.titulo).replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
    referencia: capitulo.titulo,
    propuesta: { ...capitulo, partidas },
    anterior: null,
    usoId,
  });
  await ctx.store.guardarBorradoresIA(ctx.projectId, [borrador]);
  return { borrador, costoCop, cupo: await cupoActual(ctx) };
}

// ---------------------------------------------------------------- phase 2: the resources

/** Phase 2: the resources a batch of partidas needs; the missing ones are saved as drafts to create. */
export async function generarInsumosIA(ctx: Ctx, body: unknown): Promise<GenerarInsumosResponse> {
  const o = (body ?? {}) as Record<string, unknown>;
  const contexto = texto(o.contexto, "Contexto del proyecto", MAX_CONTEXTO_IA);
  if (!Array.isArray(o.partidas) || o.partidas.length === 0) bad("No hay partidas para enviar.");
  if (o.partidas.length > MAX_PARTIDAS_LOTE_IA) bad(`Máximo ${MAX_PARTIDAS_LOTE_IA} partidas por lote.`);
  const ids = new Set<string>();
  const partidas = o.partidas.map((v, i): PartidaInsumosIA => {
    const p = (v ?? {}) as Record<string, unknown>;
    const id = idValido(p.id, `Partida ${i + 1}`);
    if (ids.has(id)) bad(`Partida ${i + 1}: está repetida.`);
    ids.add(id);
    return {
      id,
      item: texto(p.item, `Partida ${i + 1}: item`, 40),
      descripcion: texto(p.descripcion, `Partida ${i + 1}: descripción`, 300, true),
      unidad: texto(p.unidad, `Partida ${i + 1}: unidad`, 40),
      capitulo: texto(p.capitulo, `Partida ${i + 1}: capítulo`, 400),
    };
  });
  const catalogo = validarCatalogo<InsumoCatalogoIA>(o.catalogo, "Catálogo de insumos", (x, i) => {
    if (!TIPOS_INSUMO.includes(x.tipo as TipoInsumo)) bad(`Insumo del catálogo ${i + 1}: tipo no válido.`);
    return {
      id: idValido(x.id, `Insumo del catálogo ${i + 1}`),
      descripcion: texto(x.descripcion, `Insumo del catálogo ${i + 1}`, 300, true),
      unidad: texto(x.unidad, `Unidad del insumo del catálogo ${i + 1}`, 20),
      tipo: x.tipo as TipoInsumo,
    };
  });
  const { resultado, usoId, costoCop } = await llamar(ctx, {
    tarea: "insumos",
    version: VERSION_PROMPT_INSUMOS,
    sistema: SISTEMA_INSUMOS,
    datosFijos: catalogoInsumosTexto(catalogo),
    usuario: mensajeInsumos(contexto, partidas),
    esquema: ESQUEMA_INSUMOS,
    maxTokens: maxTokensInsumos(partidas.length),
    esfuerzo: ESFUERZO,
    items: partidas.length,
    leer: (t) => leerInsumos(t, partidas, catalogo),
    resumen: (r) => `${r.delCatalogo.size} del catálogo, ${r.nuevos.size} nuevos`,
  });
  const ref = new Map(partidas.map((p) => [p.id, `${p.item} ${p.descripcion}`.slice(0, 120)]));
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const borradores = [...resultado.nuevos].map(([clave, n]) =>
    nuevoBorrador<BorradorInsumoIA>(ctx, {
      tarea: "insumos",
      itemId: `ins:${clave}`.slice(0, 200),
      referencia: n.descripcion,
      propuesta: { descripcion: n.descripcion, unidad: n.unidad, tipo: n.tipo, usadoEn: [...n.partidas].map((id) => ref.get(id) ?? id) },
      anterior: null,
      usoId,
    })
  );
  // A resource already proposed by an earlier batch keeps the partidas that batch found too.
  const previos = new Map(((await ctx.store.borradoresIA(ctx.projectId, { estado: "pendiente", tarea: "insumos" })) as BorradorInsumoIA[]).map((b) => [b.itemId, b]));
  for (const b of borradores) {
    const antes = previos.get(b.itemId);
    if (antes) b.propuesta.usadoEn = [...new Set([...antes.propuesta.usadoEn, ...b.propuesta.usadoEn])].slice(0, 200);
  }
  await ctx.store.guardarBorradoresIA(ctx.projectId, borradores);
  return {
    borradores,
    delCatalogo: [...resultado.delCatalogo].map(([id, usan]) => ({ id, descripcion: porId.get(id)?.descripcion ?? id, partidas: [...usan].map((x) => ref.get(x) ?? x) })),
    costoCop,
    cupo: await cupoActual(ctx),
  };
}

// ---------------------------------------------------------------- drafts

/** The drafts of a task waiting for review. */
export async function listarBorradoresIA(ctx: Ctx, tarea: unknown = "edt"): Promise<{ borradores: BorradorGenerico[] }> {
  await requireEdit(ctx);
  const t: TareaIA = tarea === "insumos" || tarea === "estructura" ? tarea : "edt";
  return { borradores: await ctx.store.borradoresIA(ctx.projectId, { estado: "pendiente", tarea: t }) };
}

function validarFinalEdt(f: Record<string, unknown>, what: string): PropuestaEdtFinal {
  return { descripcion: texto(f.descripcion, `${what}: descripción`, MAX_TEXTO_EDT_IA), criterios: texto(f.criterios, `${what}: criterios`, MAX_TEXTO_EDT_IA) };
}

function validarFinalInsumo(f: Record<string, unknown>, what: string, b: BorradorInsumoIA): PropuestaInsumo {
  if (!TIPOS_INSUMO.includes(f.tipo as TipoInsumo)) bad(`${what}: tipo no válido.`);
  return {
    descripcion: texto(f.descripcion, `${what}: descripción`, 300, true).toUpperCase(),
    unidad: texto(f.unidad, `${what}: unidad`, 20).toUpperCase(),
    tipo: f.tipo as TipoInsumo,
    usadoEn: b.propuesta.usadoEn,
  };
}

function validarFinalCapitulo(f: Record<string, unknown>, what: string, b: BorradorEstructuraIA): PropuestaCapitulo {
  const partidas = Array.isArray(f.partidas) ? f.partidas : bad(`${what}: faltan las partidas.`);
  if (partidas.length > MAX_PARTIDAS_CAPITULO) bad(`${what}: máximo ${MAX_PARTIDAS_CAPITULO} partidas.`);
  const delCatalogo = new Set(b.propuesta.partidas.map((p) => p.catalogoId).filter(Boolean));
  return {
    titulo: texto(f.titulo, `${what}: título`, 120, true).toUpperCase(),
    alcance: texto(f.alcance, `${what}: alcance`, 300),
    porPiso: f.porPiso === true,
    partidas: partidas.map((v, i) => {
      const p = (v ?? {}) as Record<string, unknown>;
      const catalogoId = typeof p.catalogoId === "string" && delCatalogo.has(p.catalogoId) ? p.catalogoId : null;
      return { catalogoId, descripcion: texto(p.descripcion, `${what}: partida ${i + 1}`, 300, true), unidad: texto(p.unidad, `${what}: unidad ${i + 1}`, 20) };
    }),
  };
}

/**
 * { decisiones: [{ id, estado: "aceptado" | "rechazado", final? }] }, for drafts of any task.
 * The budget or the catalog change in the browser (and are saved as always);
 * this records what was accepted, edited or rejected. `final` is what was
 * applied (the proposal if not given); it counts as edited when it differs.
 */
export async function decidirBorradoresIA(ctx: Ctx, body: unknown): Promise<{ decididos: number; resumen: ResumenesIA }> {
  await requireEdit(ctx);
  const lista = (body as { decisiones?: unknown } | null)?.decisiones;
  if (!Array.isArray(lista) || lista.length === 0) bad("No hay decisiones.");
  if (lista.length > MAX_DECISIONES) bad(`Máximo ${MAX_DECISIONES} decisiones por envío.`);
  const pedidas = lista.map((v, i) => {
    const d = (v ?? {}) as Record<string, unknown>;
    if (typeof d.id !== "string" || !UUID_RE.test(d.id)) bad(`Decisión ${i + 1}: id no válido.`);
    if (d.estado !== "aceptado" && d.estado !== "rechazado") bad(`Decisión ${i + 1}: debe ser aceptado o rechazado.`);
    return { id: d.id, estado: d.estado as "aceptado" | "rechazado", final: d.final as Record<string, unknown> | undefined, n: i + 1 };
  });
  const borradores = new Map((await ctx.store.borradoresIA(ctx.projectId, { estado: "pendiente", ids: pedidas.map((d) => d.id) })).map((b) => [b.id, b]));
  const decisiones = pedidas
    .filter((d) => borradores.has(d.id))
    .map((d) => {
      const b = borradores.get(d.id)!;
      if (d.estado === "rechazado") return { id: d.id, estado: d.estado, editado: false, final: null };
      const what = `Decisión ${d.n}`;
      const f = d.final && typeof d.final === "object" ? d.final : null;
      const final =
        b.tarea === "edt"
          ? f
            ? validarFinalEdt(f, what)
            : { descripcion: (b as BorradorIA).propuesta.descripcion, criterios: (b as BorradorIA).propuesta.criterios }
          : b.tarea === "insumos"
            ? f
              ? validarFinalInsumo(f, what, b as BorradorInsumoIA)
              : (b as BorradorInsumoIA).propuesta
            : f
              ? validarFinalCapitulo(f, what, b as BorradorEstructuraIA)
              : (b as BorradorEstructuraIA).propuesta;
      const propuesta = b.tarea === "edt" ? { descripcion: (b as BorradorIA).propuesta.descripcion, criterios: (b as BorradorIA).propuesta.criterios } : b.propuesta;
      return { id: d.id, estado: d.estado, editado: JSON.stringify(final) !== JSON.stringify(propuesta), final };
    });
  const decididos = decisiones.length ? await ctx.store.decidirBorradoresIA(ctx.projectId, decisiones, ctx.caller.name) : 0;
  return { decididos, resumen: await ctx.store.resumenBorradoresIA(ctx.projectId) };
}
