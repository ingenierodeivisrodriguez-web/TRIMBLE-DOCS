import { fmt } from "../presupuesto/format";
import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { ProjectContacts } from "../propiedades/types";
import { esMotivo, ESTADO_HTTP, estadoAsignacion, MENSAJES, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol, tiene } from "./accesos";
import { esDocumento, insumosPlanificados, metradosDelModelo } from "./planificado";
import type { LecturaPresupuesto } from "./presupuestoLectura";
import { ARCHIVO_PRUEBA, buscarEnCarpeta, CARPETA_PRUEBA, ClienteTrimble, contenidoPrueba, crearCarpeta, enviarContenido, estadoSubida, explicarEstado, iniciarSubida, leerCarpeta, urlDescarga } from "./cde";
import { CARPETA_DE, CARPETAS, carpetaProveedor, MAX_RELEVO, MAX_TAMANO, MODULO_DE, nombreArchivo, revisarTipos, rutaCarpeta, TIPOS_LEGALES_INICIALES, tiposDe } from "./documentos";
import { nitConDv } from "./proveedores";
import { numeroCotizacion } from "./cotizaciones";
import { evaluar, razonesJustificacion, revisarComparativo, revisarCotizacion } from "./cotizaciones";
import { fechaHora } from "./formato";
import { comprometidoPorInsumo, comprometidoPorLinea, maximoLinea, numeroOrden, revisarAccionOrden, revisarOrden } from "./ordenes";
import { aceptadoDeOrden, numeroRecepcion, ordenesPorRecibir, recibidoPorInsumo, revisarAccionRecepcion, revisarRecepcion, tieneRecepciones } from "./recepciones";
import { excesos, limite, numeroRequisicion, puedeEditar, revisarAccion, solicitadoPorInsumo } from "./requisiciones";
import { ROLES_INICIALES } from "./roles";
import type { Actor, ComprasStore, LineaGuardada, OrdenGuardada } from "./store";
import {
  leerAccionOrden,
  leerAccionRecepcion,
  leerCambioOrden,
  leerCambioRecepcion,
  leerAccionComparativo,
  leerAccionRequisicion,
  leerAnulacion,
  leerCambioAsignacion,
  leerCambioCotizacion,
  leerCambioProveedor,
  leerCambioRequisicion,
  leerCambioRol,
  leerConfig,
  leerEstadoProveedor,
  leerFiltroAuditoria,
} from "./validate";
import {
  AccesosResponse,
  Accion,
  Asignacion,
  ConfigCompras,
  CotizacionesResponse,
  EntradaAuditoria,
  EstadoResponse,
  InsumoPlanificado,
  InsumosResponse,
  Modulo,
  OrdenesResponse,
  RecepcionesResponse,
  PasoPruebaCde,
  Permiso,
  PruebaCdeResponse,
  CarpetaCde,
  Documento,
  DocumentosResponse,
  EntidadDocumento,
  EstadoCarpetas,
  NuevoDocumento,
  SubidaDocumento,
  SyncEntrada,
  TipoDocumentoLegal,
  TIPO_ORDEN,
  ProveedoresResponse,
  Requisicion,
  RequisicionesResponse,
  Rol,
  ROL_ADMIN,
} from "./types";

/** Everything an operation needs: who calls, in which project, and today (Colombia). */
export interface Ctx {
  projectId: string;
  caller: Caller;
  store: ComprasStore;
  /** The budget of Presupuesto, read only. */
  presupuesto: LecturaPresupuesto;
  /** YYYY-MM-DD in Colombia. */
  hoy: string;
  deps: {
    /** The project's team in Trimble Connect (people and groups). */
    contactos: () => Promise<ProjectContacts>;
    /** The Core API of the project's region with the caller's token, and the project's root folder. */
    cde?: () => Promise<{ cliente: ClienteTrimble; rootId: string }>;
    /** For the content PUT to Trimble's signed URL (tests replace it). */
    fetch?: typeof fetch;
  };
}

export function rechazo(motivo: MotivoRechazo): ServiceError {
  return new ServiceError(MENSAJES[motivo], ESTADO_HTTP[motivo], motivo);
}

/** A refusal from the store (the SQL rules) as the message the person reads. */
export function traducir(err: unknown): unknown {
  return err instanceof StoreError && esMotivo(err.message) ? rechazo(err.message) : err;
}

const actor = (ctx: Ctx): Actor => ({ id: ctx.caller.id, nombre: ctx.caller.name });

interface Accesos {
  roles: Rol[];
  usuarios: Asignacion[];
  permisos: Permiso[];
}

/** Read on every request (no cache), so a revoked access stops working at once. */
async function cargar(ctx: Ctx): Promise<Accesos> {
  const [roles, usuarios] = await Promise.all([ctx.store.listRoles(ctx.projectId), ctx.store.listUsuarios(ctx.projectId)]);
  return { roles, usuarios, permisos: permisosVigentes(ctx.caller.id, usuarios, roles, ctx.hoy) };
}

async function denegar(ctx: Ctx, accion: string, modulo: string, motivo: MotivoRechazo, extra: Partial<EntradaAuditoria> = {}): Promise<never> {
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id,
    actorNombre: ctx.caller.name,
    accion,
    modulo,
    objetoTipo: "",
    objetoId: "",
    sujetoId: null,
    sujetoNombre: "",
    resultado: "denegado",
    ...extra,
    detalle: { motivo, ...(extra.detalle ?? {}) },
  });
  throw rechazo(motivo);
}

/** Denies by default: without an access in force, or without this permission, the attempt is audited and refused. */
export async function requerir(ctx: Ctx, modulo: Modulo, accion: Accion, que: string): Promise<Accesos> {
  const a = await cargar(ctx);
  if (!a.permisos.length) return denegar(ctx, que, modulo, "sin-acceso", { detalle: { permiso: `${modulo}.${accion}` } });
  if (!tiene(a.permisos, modulo, accion)) return denegar(ctx, que, modulo, "sin-permiso", { detalle: { permiso: `${modulo}.${accion}` } });
  return a;
}

function administradores(a: Pick<Accesos, "roles" | "usuarios">, hoy: string): Asignacion[] {
  return a.usuarios.filter((u) => {
    const rol = a.roles.find((r) => r.id === u.rolId);
    return !!rol && rol.activo && tiene(rol.permisos, "accesos", "administrar") && estadoAsignacion(u, hoy) === "vigente";
  });
}

// ---------------------------------------------------------------- state and activation

export async function getEstado(ctx: Ctx): Promise<EstadoResponse> {
  const a = await cargar(ctx);
  const admins = administradores(a, ctx.hoy);
  const activo = admins.some((u) => a.roles.find((r) => r.id === u.rolId)?.clave === ROL_ADMIN);
  const mia = a.usuarios.find((u) => u.userId === ctx.caller.id);
  const rol = mia && a.roles.find((r) => r.id === mia.rolId);
  if (!a.permisos.length) {
    // Every attempt to get in without an access is recorded.
    await ctx.store.auditar(ctx.projectId, {
      actorId: ctx.caller.id,
      actorNombre: ctx.caller.name,
      accion: "ingreso",
      modulo: "accesos",
      objetoTipo: "proyecto",
      objetoId: ctx.projectId,
      sujetoId: null,
      sujetoNombre: "",
      resultado: "denegado",
      detalle: { motivo: activo ? "sin-acceso" : "no-activado", estado: mia ? estadoAsignacion(mia, ctx.hoy) : "sin-asignacion" },
    });
  }
  return {
    projectId: ctx.projectId,
    user: { id: ctx.caller.id, name: ctx.caller.name },
    esAdminTrimble: ctx.caller.isAdmin,
    activo,
    acceso: a.permisos.length && mia && rol ? { rol: { id: rol.id, nombre: rol.nombre }, desde: mia.desde, hasta: mia.hasta, permisos: a.permisos } : null,
    puedeActivar: !activo && ctx.caller.isAdmin,
    administradores: admins.map((u) => u.nombre || u.email || u.userId),
  };
}

/** Turns Compras on: a Trimble administrator of the project becomes its first Administrador de plataforma. */
export async function activar(ctx: Ctx): Promise<EstadoResponse> {
  if (!ctx.caller.isAdmin) {
    return denegar(ctx, "proyecto.activar", "accesos", "no-admin-trimble", { objetoTipo: "proyecto", objetoId: ctx.projectId });
  }
  const yo = (await ctx.deps.contactos()).users.find((u) => u.id === ctx.caller.id);
  try {
    await ctx.store.activar(ctx.projectId, { id: ctx.caller.id, nombre: yo?.name || ctx.caller.name, email: yo?.email ?? "" }, ROLES_INICIALES);
  } catch (err) {
    throw traducir(err);
  }
  return getEstado(ctx);
}

// ---------------------------------------------------------------- accesses

export async function getAccesos(ctx: Ctx): Promise<AccesosResponse> {
  const a = await requerir(ctx, "accesos", "ver", "accesos.consultar");
  return { roles: a.roles, usuarios: a.usuarios, misPermisos: a.permisos, hoy: ctx.hoy };
}

/** The project's people in Trimble Connect, to choose whom to give an access. */
export async function getContactos(ctx: Ctx): Promise<ProjectContacts> {
  await requerir(ctx, "accesos", "administrar", "accesos.contactos");
  const { users } = await ctx.deps.contactos();
  return { users, groups: [] };
}

/** Gives, changes or revokes one person's access. */
export async function guardarUsuario(ctx: Ctx, body: unknown): Promise<AccesosResponse> {
  const cambio = leerCambioAsignacion(body);
  const a = await requerir(ctx, "accesos", "administrar", "accesos.guardar");
  const audit = { objetoTipo: "usuario", objetoId: cambio.userId, sujetoId: cambio.userId };
  const motivo = revisarAsignacion({ actorId: ctx.caller.id, misPermisos: a.permisos, roles: a.roles, usuarios: a.usuarios, hoy: ctx.hoy }, cambio);
  if (motivo === "version-conflict") throw rechazo(motivo);
  if (motivo) return denegar(ctx, "accesos.guardar", "accesos", motivo, audit);

  // Accesses are given to members of the project; revoking works even for someone who left it.
  const antes = a.usuarios.find((u) => u.userId === cambio.userId);
  const contacto = (await ctx.deps.contactos()).users.find((u) => u.id === cambio.userId);
  if (!contacto && cambio.activo) return denegar(ctx, "accesos.guardar", "accesos", "no-miembro", audit);
  const persona = { nombre: contacto?.name ?? antes?.nombre ?? cambio.userId, email: contacto?.email ?? antes?.email ?? "" };
  try {
    await ctx.store.guardarUsuario(ctx.projectId, actor(ctx), persona, cambio);
  } catch (err) {
    const e = traducir(err);
    // Refused by the database (someone changed something meanwhile): recorded as well.
    if (e instanceof ServiceError && e.code && e.code !== "version-conflict") {
      await denegar(ctx, "accesos.guardar", "accesos", e.code as MotivoRechazo, { ...audit, sujetoNombre: persona.nombre });
    }
    throw e;
  }
  return getAccesos(ctx);
}

/** Creates or changes a role of the matrix. */
export async function guardarRol(ctx: Ctx, body: unknown): Promise<AccesosResponse> {
  const cambio = leerCambioRol(body);
  const a = await requerir(ctx, "accesos", "administrar", "roles.guardar");
  const audit = { objetoTipo: "rol", objetoId: cambio.id ?? "", sujetoNombre: cambio.nombre };
  const motivo = revisarRol({ actorId: ctx.caller.id, misPermisos: a.permisos, roles: a.roles, usuarios: a.usuarios, hoy: ctx.hoy }, cambio);
  if (motivo === "version-conflict" || motivo === "datos") throw rechazo(motivo);
  if (motivo) return denegar(ctx, "roles.guardar", "accesos", motivo, audit);
  if (cambio.id && !a.roles.some((r) => r.id === cambio.id)) throw new ServiceError("El rol no existe en este proyecto.", 404);
  try {
    await ctx.store.guardarRol(ctx.projectId, actor(ctx), { ...cambio, id: cambio.id ?? globalThis.crypto.randomUUID() });
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && !["version-conflict", "nombre-repetido", "datos"].includes(e.code)) {
      await denegar(ctx, "roles.guardar", "accesos", e.code as MotivoRechazo, audit);
    }
    throw e;
  }
  return getAccesos(ctx);
}

// ---------------------------------------------------------------- audit

export async function getAuditoria(ctx: Ctx, params: URLSearchParams): Promise<{ entradas: EntradaAuditoria[] }> {
  const filtro = leerFiltroAuditoria(params);
  await requerir(ctx, "auditoria", "ver", "auditoria.consultar");
  return { entradas: await ctx.store.listAuditoria(ctx.projectId, filtro) };
}

// ---------------------------------------------------------------- planned resources

/** The resources planned in the project's budget (Presupuesto), with where each one is used. */
/** The budget as it is now: its version and planned resources (null: no saved budget). */
async function planActual(ctx: Ctx): Promise<{ presupuesto: InsumosResponse["presupuesto"]; insumos: InsumoPlanificado[]; porcentaje: InsumosResponse["porcentaje"] }> {
  const [documento, mediciones, resumen] = await Promise.all([
    ctx.presupuesto.documento(ctx.projectId),
    ctx.presupuesto.mediciones(ctx.projectId),
    ctx.presupuesto.resumenElementos(ctx.projectId),
  ]);
  if (!documento) return { presupuesto: null, insumos: [], porcentaje: [] };
  if (!esDocumento(documento.data)) throw new ServiceError("El presupuesto guardado no se pudo leer. Ábrelo en Presupuesto y vuelve a guardarlo.", 500);
  const doc = documento.data;
  return {
    presupuesto: { version: documento.version, actualizado: documento.updatedAt, actualizadoPor: documento.updatedBy },
    ...insumosPlanificados(doc, metradosDelModelo(doc, mediciones, resumen)),
  };
}

/** The resources planned in the project's budget (Presupuesto), with where each one is used and what was asked of each. */
export async function getInsumos(ctx: Ctx): Promise<InsumosResponse> {
  await requerir(ctx, "insumos", "ver", "insumos.consultar");
  const [plan, requisiciones, ordenes, recepciones] = await Promise.all([
    planActual(ctx),
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listOrdenes(ctx.projectId),
    ctx.store.listRecepciones(ctx.projectId),
  ]);
  const pedidos = solicitadoPorInsumo(requisiciones);
  const comprometido = comprometidoPorInsumo(ordenes);
  const recibido = recibidoPorInsumo(recepciones);
  return {
    ...plan,
    insumos: plan.insumos.map((i) => ({ ...i, solicitado: pedidos.get(i.id)?.solicitado ?? 0, aprobado: pedidos.get(i.id)?.aprobado ?? 0, comprometido: comprometido.get(i.id) ?? 0, recibido: recibido.get(i.id) ?? 0 })),
  };
}

// ---------------------------------------------------------------- requisitions

export async function getRequisiciones(ctx: Ctx): Promise<RequisicionesResponse> {
  await requerir(ctx, "requisiciones", "ver", "requisiciones.consultar");
  const [requisiciones, config] = await Promise.all([ctx.store.listRequisiciones(ctx.projectId), ctx.store.getConfig(ctx.projectId)]);
  return { requisiciones, config, hoy: ctx.hoy };
}

/** Creates or changes a draft. The resources' data (code, description, unit, type, price) comes from the budget, never from the browser. */
export async function guardarRequisicion(ctx: Ctx, body: unknown): Promise<RequisicionesResponse> {
  const cambio = leerCambioRequisicion(body);
  const a = await requerir(ctx, "requisiciones", "ver", "requisiciones.guardar");
  const audit = { objetoTipo: "requisicion", objetoId: cambio.id ?? "" };
  const todas = await ctx.store.listRequisiciones(ctx.projectId);
  const antes = cambio.id ? todas.find((r) => r.id === cambio.id) : undefined;
  if (antes) {
    if (antes.estado !== "borrador") throw rechazo("estado-no-valido");
    if (!puedeEditar(antes, ctx.caller.id, a.permisos)) return denegar(ctx, "requisiciones.guardar", "requisiciones", "sin-permiso", { ...audit, sujetoNombre: numeroRequisicion(antes.numero) });
  } else if (!tiene(a.permisos, "requisiciones", "crear")) {
    return denegar(ctx, "requisiciones.guardar", "requisiciones", "sin-permiso", audit);
  }

  const plan = await planActual(ctx);
  const porId = new Map(plan.insumos.map((i) => [i.id, i]));
  const claves = new Set<string>();
  const lineas: LineaGuardada[] = cambio.lineas.map((l, n) => {
    const ins = porId.get(l.insumoId);
    if (!ins) throw new ServiceError(`Línea ${n + 1}: ${MENSAJES["insumo-no-valido"]}`, 400, "insumo-no-valido");
    if (l.partidaItemId && !ins.usos.some((u) => u.itemId === l.partidaItemId)) {
      throw new ServiceError(`Línea ${n + 1}: la partida elegida no usa ${ins.descripcion}.`, 400, "insumo-no-valido");
    }
    const clave = `${l.insumoId}|${l.partidaItemId ?? ""}`;
    if (claves.has(clave)) throw new ServiceError(`${ins.descripcion}: ${MENSAJES["linea-duplicada"]}`, 409, "linea-duplicada");
    claves.add(clave);
    const previa = antes?.lineas.find((x) => x.insumoId === l.insumoId && x.partidaItemId === l.partidaItemId);
    return {
      id: previa?.id ?? globalThis.crypto.randomUUID(),
      insumoId: ins.id,
      partidaItemId: l.partidaItemId,
      codigo: ins.codigo,
      descripcion: ins.descripcion,
      unidad: ins.unidad,
      tipo: ins.tipo,
      precio: ins.precio,
      cantidad: l.cantidad,
      justificacionExceso: l.justificacionExceso,
    };
  });
  const id = cambio.id ?? globalThis.crypto.randomUUID();
  try {
    await ctx.store.guardarRequisicion(ctx.projectId, actor(ctx), id, { fechaRequerida: cambio.fechaRequerida, prioridad: cambio.prioridad, justificacion: cambio.justificacion }, lineas, cambio.version);
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code === "sin-permiso") await denegar(ctx, "requisiciones.guardar", "requisiciones", "sin-permiso", { ...audit, objetoId: id });
    throw e;
  }
  return getRequisiciones(ctx);
}

/** Refusals that are about who may do it (audited); the rest are about the data. */
const DENEGACIONES = new Set<MotivoRechazo>(["sin-permiso", "auto-aprobacion", "exceso-sin-permiso"]);

/** Sends, approves, rejects, returns or cancels a requisition. */
export async function accionRequisicion(ctx: Ctx, id: string, body: unknown): Promise<RequisicionesResponse> {
  const a = leerAccionRequisicion(body);
  const acc = await requerir(ctx, "requisiciones", "ver", `requisiciones.${a.accion}`);
  const [todas, config, plan] = await Promise.all([ctx.store.listRequisiciones(ctx.projectId), ctx.store.getConfig(ctx.projectId), planActual(ctx)]);
  const r = todas.find((x) => x.id === id);
  if (!r) throw rechazo("no-existe");
  const audit = { objetoTipo: "requisicion", objetoId: r.id, sujetoId: r.solicitanteId, sujetoNombre: numeroRequisicion(r.numero) };
  const planificados = new Map(plan.insumos.map((i) => [i.id, i.cantidad]));
  const reglas = { actorId: ctx.caller.id, permisos: acc.permisos, hoy: ctx.hoy, toleranciaPct: config.toleranciaPct, planificados, requisiciones: todas };
  const motivo = revisarAccion(reglas, r, a);
  if (motivo && DENEGACIONES.has(motivo)) return denegar(ctx, `requisiciones.${a.accion}`, "requisiciones", motivo, audit);
  if (motivo) throw detalleRechazo(motivo, r, reglas);

  const limites: Record<string, { planificado: number; limite: number }> = {};
  for (const l of r.lineas) {
    const p = planificados.get(l.insumoId) ?? 0;
    limites[l.insumoId] = { planificado: p, limite: limite(p, config.toleranciaPct) };
  }
  try {
    await ctx.store.cambiarEstadoRequisicion(ctx.projectId, actor(ctx), r.id, a, limites, plan.presupuesto?.version ?? null);
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && DENEGACIONES.has(e.code as MotivoRechazo)) {
      await denegar(ctx, `requisiciones.${a.accion}`, "requisiciones", e.code as MotivoRechazo, audit);
    }
    throw e;
  }
  return getRequisiciones(ctx);
}

/** A refusal over the budget, saying which resource and by how much. */
function detalleRechazo(motivo: MotivoRechazo, r: Requisicion, reglas: Parameters<typeof revisarAccion>[0]): ServiceError {
  if (motivo !== "cantidad-excedida") return rechazo(motivo);
  const otros = solicitadoPorInsumo(reglas.requisiciones, r.id);
  const sinJustificar = new Set(r.lineas.filter((l) => !l.justificacionExceso.trim()).map((l) => l.insumoId));
  const lista = excesos(r.lineas, reglas.planificados, reglas.toleranciaPct, otros)
    .filter((e) => sinJustificar.has(e.insumoId))
    .map(
      (e) =>
        `${e.descripcion}: se pedirían ${fmt(e.otros + e.pedido, 4)} ${e.unidad} en total (ya pedidos ${fmt(e.otros, 4)}) y el límite es ${fmt(e.limite, 4)} (planificado ${fmt(e.planificado, 4)} + tolerancia ${fmt(reglas.toleranciaPct)} %)`
    );
  return new ServiceError(`${lista.join("; ")}. Escribe la justificación del exceso en esa línea o baja la cantidad.`, 409, motivo);
}

/** Changes the tolerance over the planned quantities and the minimum of quotations (Accesos y roles: administrar). */
export async function guardarConfig(ctx: Ctx, body: unknown): Promise<ConfigCompras> {
  const c = leerConfig(body);
  await requerir(ctx, "accesos", "administrar", "config.cambiar");
  await ctx.store.guardarConfig(ctx.projectId, actor(ctx), { toleranciaPct: c.toleranciaPct, minCotizaciones: c.minCotizaciones }, c.version);
  return ctx.store.getConfig(ctx.projectId);
}

// ---------------------------------------------------------------- suppliers

export async function getProveedores(ctx: Ctx): Promise<ProveedoresResponse> {
  const a = await requerir(ctx, "proveedores", "ver", "proveedores.consultar");
  const [proveedores, cotizaciones] = await Promise.all([
    ctx.store.listProveedores(ctx.projectId),
    tiene(a.permisos, "cotizaciones", "ver") ? ctx.store.listCotizaciones(ctx.projectId) : Promise.resolve([]),
  ]);
  return { proveedores, cotizaciones, hoy: ctx.hoy };
}

/** Creates or changes a supplier (its check digit computed from the NIT). */
export async function guardarProveedor(ctx: Ctx, body: unknown): Promise<ProveedoresResponse> {
  const { id: idDado, version, ...datos } = leerCambioProveedor(body);
  const a = await requerir(ctx, "proveedores", "ver", "proveedores.guardar");
  const lista = await ctx.store.listProveedores(ctx.projectId);
  const antes = idDado ? lista.find((p) => p.id === idDado) : undefined;
  const audit = { objetoTipo: "proveedor", objetoId: idDado ?? "", sujetoNombre: datos.razonSocial };
  if (!tiene(a.permisos, "proveedores", antes ? "editar" : "crear")) return denegar(ctx, "proveedores.guardar", "proveedores", "sin-permiso", audit);
  if (lista.some((p) => p.nit === datos.nit && p.id !== idDado)) throw rechazo("nit-repetido");
  try {
    await ctx.store.guardarProveedor(ctx.projectId, actor(ctx), idDado ?? globalThis.crypto.randomUUID(), datos, version);
  } catch (err) {
    throw traducir(err);
  }
  return getProveedores(ctx);
}

/** Activates, deactivates or blocks a supplier (Proveedores: anular); deactivating or blocking needs a reason. */
export async function estadoProveedor(ctx: Ctx, id: string, body: unknown): Promise<ProveedoresResponse> {
  const c = leerEstadoProveedor(body);
  await requerir(ctx, "proveedores", "anular", "proveedores.estado");
  if (c.estado !== "activo" && !c.motivo) throw rechazo("motivo-requerido");
  try {
    await ctx.store.estadoProveedor(ctx.projectId, actor(ctx), id, c.estado, c.motivo, c.version);
  } catch (err) {
    throw traducir(err);
  }
  return getProveedores(ctx);
}

// ---------------------------------------------------------------- quotations and comparisons

/** Approved requisitions with their quotations, comparisons and the suppliers. */
export async function getCotizaciones(ctx: Ctx): Promise<CotizacionesResponse> {
  await requerir(ctx, "cotizaciones", "ver", "cotizaciones.consultar");
  const [requisiciones, cotizaciones, comparativos, proveedores, config] = await Promise.all([
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listProveedores(ctx.projectId),
    ctx.store.getConfig(ctx.projectId),
  ]);
  return { requisiciones: requisiciones.filter((r) => r.estado === "aprobada"), cotizaciones, comparativos, proveedores, config, hoy: ctx.hoy };
}

/** Registers or corrects a supplier's quotation for an approved requisition. */
export async function guardarCotizacion(ctx: Ctx, body: unknown): Promise<CotizacionesResponse> {
  const c = leerCambioCotizacion(body);
  const a = await requerir(ctx, "cotizaciones", "ver", "cotizaciones.guardar");
  const [reqs, cots, comps, provs, config] = await Promise.all([
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listProveedores(ctx.projectId),
    ctx.store.getConfig(ctx.projectId),
  ]);
  const antes = c.id ? cots.find((x) => x.id === c.id) ?? null : null;
  const r = reqs.find((x) => x.id === c.requisicionId);
  const audit = { objetoTipo: "cotizacion", objetoId: c.id ?? "", sujetoNombre: r ? numeroRequisicion(r.numero) : "" };
  const reglas = { actorId: ctx.caller.id, permisos: a.permisos, hoy: ctx.hoy, minCotizaciones: config.minCotizaciones };
  const motivo = revisarCotizacion(reglas, c, antes, r, comps.find((x) => x.requisicionId === c.requisicionId), provs.find((p) => p.id === c.proveedorId), cots);
  if (motivo === "sin-permiso") return denegar(ctx, "cotizaciones.guardar", "cotizaciones", motivo, audit);
  if (motivo) throw rechazo(motivo);
  const id = c.id ?? globalThis.crypto.randomUUID();
  const lineas = c.lineas.map((l) => ({ ...l, id: antes?.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId)?.id ?? globalThis.crypto.randomUUID() }));
  try {
    await ctx.store.guardarCotizacion(ctx.projectId, actor(ctx), id, { ...c, lineas });
  } catch (err) {
    throw traducir(err);
  }
  return getCotizaciones(ctx);
}

export async function anularCotizacion(ctx: Ctx, id: string, body: unknown): Promise<CotizacionesResponse> {
  const c = leerAnulacion(body);
  await requerir(ctx, "cotizaciones", "anular", "cotizaciones.anular");
  if (!c.motivo) throw rechazo("motivo-requerido");
  try {
    await ctx.store.anularCotizacion(ctx.projectId, actor(ctx), id, c.motivo, c.version);
  } catch (err) {
    throw traducir(err);
  }
  return getCotizaciones(ctx);
}

/** Saves, proposes, approves or returns a requisition's comparison. */
export async function accionComparativo(ctx: Ctx, requisicionId: string, body: unknown): Promise<CotizacionesResponse> {
  const a = leerAccionComparativo(body);
  const acc = await requerir(ctx, "cotizaciones", "ver", `comparativos.${a.accion}`);
  const [reqs, cots, comps, provs, config] = await Promise.all([
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listProveedores(ctx.projectId),
    ctx.store.getConfig(ctx.projectId),
  ]);
  const r = reqs.find((x) => x.id === requisicionId);
  if (!r) throw rechazo("no-existe");
  const comparativo = comps.find((x) => x.requisicionId === requisicionId);
  const audit = { objetoTipo: "comparativo", objetoId: requisicionId, sujetoId: comparativo?.propuestoPorId ?? null, sujetoNombre: numeroRequisicion(r.numero) };
  const evaluaciones = evaluar(cots, r, new Map(provs.map((p) => [p.id, p])), a.criterios, ctx.hoy);
  const reglas = { actorId: ctx.caller.id, permisos: acc.permisos, hoy: ctx.hoy, minCotizaciones: config.minCotizaciones };
  const motivo = revisarComparativo(reglas, r, comparativo, evaluaciones, a);
  if (motivo && DENEGACIONES.has(motivo)) return denegar(ctx, `comparativos.${a.accion}`, "cotizaciones", motivo, audit);
  if (motivo === "justificacion-requerida") {
    const razones = razonesJustificacion(evaluaciones, a.cotizacionElegidaId, config.minCotizaciones);
    throw new ServiceError(`${razones.join(" ")} Escribe la justificación de la elección.`, 400, motivo);
  }
  if (motivo) throw rechazo(motivo);
  const requiere = a.accion === "proponer" && razonesJustificacion(evaluaciones, a.cotizacionElegidaId, config.minCotizaciones).length > 0;
  try {
    await ctx.store.accionComparativo(ctx.projectId, actor(ctx), requisicionId, a, requiere);
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && DENEGACIONES.has(e.code as MotivoRechazo)) {
      await denegar(ctx, `comparativos.${a.accion}`, "cotizaciones", e.code as MotivoRechazo, audit);
    }
    throw e;
  }
  return getCotizaciones(ctx);
}

// ---------------------------------------------------------------- purchase orders and contracts

/** Orders and contracts the caller can see (by type), their revisions, and the chosen suppliers still to order. */
export async function getOrdenes(ctx: Ctx): Promise<OrdenesResponse> {
  const a = await cargar(ctx);
  const veOrdenes = tiene(a.permisos, "ordenes", "ver");
  const veContratos = tiene(a.permisos, "contratos", "ver");
  if (!veOrdenes && !veContratos) await requerir(ctx, "ordenes", "ver", "ordenes.consultar");
  const [ordenes, revisiones, requisiciones, comparativos, cotizaciones, proveedores] = await Promise.all([
    ctx.store.listOrdenes(ctx.projectId),
    ctx.store.listRevisiones(ctx.projectId),
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
    ctx.store.listProveedores(ctx.projectId),
  ]);
  const visibles = ordenes.filter((o) => (o.tipo === "orden" ? veOrdenes : veContratos));
  const ids = new Set(visibles.map((o) => o.id));
  const tomado = comprometidoPorLinea(ordenes);
  const porOrdenar = comparativos.flatMap((c) => {
    const requisicion = requisiciones.find((r) => r.id === c.requisicionId && r.estado === "aprobada");
    const cotizacion = cotizaciones.find((x) => x.id === c.cotizacionElegidaId);
    const proveedor = proveedores.find((p) => p.id === cotizacion?.proveedorId);
    if (c.estado !== "aprobado" || !requisicion || !cotizacion || !proveedor) return [];
    const pendientes = Object.fromEntries(
      cotizacion.lineas.flatMap((cl) => {
        const rl = requisicion.lineas.find((x) => x.id === cl.requisicionLineaId);
        return rl ? [[rl.id, maximoLinea(rl, cl.cantidad, tomado.get(rl.id) ?? 0)]] : [];
      })
    );
    return [{ requisicion, cotizacion, proveedor, pendientes }];
  });
  return { ordenes: visibles, revisiones: revisiones.filter((r) => ids.has(r.ordenId)), porOrdenar, proveedores, hoy: ctx.hoy };
}

/** Creates or changes the draft of an order or contract from the chosen supplier's quotation. */
export async function guardarOrden(ctx: Ctx, body: unknown): Promise<OrdenesResponse> {
  const c = leerCambioOrden(body);
  const m = TIPO_ORDEN[c.tipo].modulo;
  const a = await requerir(ctx, m, "ver", `${m}.guardar`);
  const [ordenes, requisiciones, comparativos, cotizaciones, recepciones] = await Promise.all([
    ctx.store.listOrdenes(ctx.projectId),
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
    ctx.store.listRecepciones(ctx.projectId),
  ]);
  const antes = c.id ? ordenes.find((o) => o.id === c.id) ?? null : null;
  const r = requisiciones.find((x) => x.id === c.requisicionId);
  const comp = comparativos.find((x) => x.requisicionId === c.requisicionId);
  const cot = cotizaciones.find((x) => x.id === comp?.cotizacionElegidaId);
  const audit = { objetoTipo: c.tipo, objetoId: c.id ?? "", sujetoNombre: antes ? numeroOrden(antes.tipo, antes.numero) : r ? numeroRequisicion(r.numero) : "" };
  const motivo = revisarOrden({ actorId: ctx.caller.id, permisos: a.permisos, hoy: ctx.hoy }, c, antes, r, comp, cot, ordenes, antes ? aceptadoDeOrden(recepciones, antes.id) : new Map());
  if (motivo === "sin-permiso") return denegar(ctx, `${m}.guardar`, m, motivo, audit);
  if (motivo) throw rechazo(motivo);
  // Prices come from the chosen quotation; only a modification (revision 1 or more) can change them.
  const modifica = (antes?.revision ?? 0) > 0;
  const guardada: OrdenGuardada = {
    ...c,
    lineas: c.lineas.map((l) => {
      const cl = cot!.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId)!;
      const previa = antes?.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId);
      return {
        requisicionLineaId: l.requisicionLineaId,
        cantidad: l.cantidad,
        precioUnitario: modifica ? l.precioUnitario ?? previa?.precioUnitario ?? cl.precioUnitario : cl.precioUnitario,
        descuentoPct: modifica ? l.descuentoPct ?? previa?.descuentoPct ?? cl.descuentoPct : cl.descuentoPct,
        ivaPct: modifica ? l.ivaPct ?? previa?.ivaPct ?? cl.ivaPct : cl.ivaPct,
      };
    }),
  };
  try {
    await ctx.store.guardarOrden(ctx.projectId, actor(ctx), c.id ?? globalThis.crypto.randomUUID(), guardada);
  } catch (err) {
    throw traducir(err);
  }
  return getOrdenes(ctx);
}

/** Sends, approves (issues), returns, cancels or modifies an order or contract. */
export async function accionOrden(ctx: Ctx, id: string, body: unknown): Promise<OrdenesResponse> {
  const a = leerAccionOrden(body);
  const o = (await ctx.store.listOrdenes(ctx.projectId)).find((x) => x.id === id);
  if (!o) throw rechazo("no-existe");
  const m = TIPO_ORDEN[o.tipo].modulo;
  const acc = await requerir(ctx, m, "ver", `${m}.${a.accion}`);
  const audit = { objetoTipo: o.tipo, objetoId: o.id, sujetoId: o.elaboradoPorId, sujetoNombre: numeroOrden(o.tipo, o.numero) };
  const recepciones = a.accion === "anular" ? await ctx.store.listRecepciones(ctx.projectId) : [];
  const motivo = revisarAccionOrden({ actorId: ctx.caller.id, permisos: acc.permisos, hoy: ctx.hoy }, o, a, tieneRecepciones(recepciones, o.id));
  if (motivo && DENEGACIONES.has(motivo)) return denegar(ctx, `${m}.${a.accion}`, m, motivo, audit);
  if (motivo) throw rechazo(motivo);
  try {
    await ctx.store.accionOrden(ctx.projectId, actor(ctx), id, a);
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && DENEGACIONES.has(e.code as MotivoRechazo)) await denegar(ctx, `${m}.${a.accion}`, m, e.code as MotivoRechazo, audit);
    throw e;
  }
  return getOrdenes(ctx);
}

// ---------------------------------------------------------------- receptions on site

/** Receptions, and the issued orders and contracts with what is still to receive (no prices). Recepciones: ver. */
export async function getRecepciones(ctx: Ctx): Promise<RecepcionesResponse> {
  await requerir(ctx, "recepciones", "ver", "recepciones.consultar");
  const [recepciones, ordenes, proveedores] = await Promise.all([
    ctx.store.listRecepciones(ctx.projectId),
    ctx.store.listOrdenes(ctx.projectId),
    ctx.store.listProveedores(ctx.projectId),
  ]);
  return { recepciones, ordenes: ordenesPorRecibir(ordenes, recepciones, proveedores), hoy: ctx.hoy };
}

/** Creates or changes a draft reception of an issued order or contract. */
export async function guardarRecepcion(ctx: Ctx, body: unknown): Promise<RecepcionesResponse> {
  const c = leerCambioRecepcion(body);
  const a = await requerir(ctx, "recepciones", "ver", "recepciones.guardar");
  const [recepciones, ordenes] = await Promise.all([ctx.store.listRecepciones(ctx.projectId), ctx.store.listOrdenes(ctx.projectId)]);
  const antes = c.id ? recepciones.find((r) => r.id === c.id) ?? null : null;
  const orden = ordenes.find((o) => o.id === c.ordenId);
  const audit = { objetoTipo: "recepcion", objetoId: c.id ?? "", sujetoNombre: antes ? numeroRecepcion(antes.numero) : orden ? numeroOrden(orden.tipo, orden.numero) : "" };
  const motivo = revisarRecepcion({ actorId: ctx.caller.id, permisos: a.permisos, hoy: ctx.hoy }, c, antes, orden, recepciones);
  if (motivo === "sin-permiso") return denegar(ctx, "recepciones.guardar", "recepciones", motivo, audit);
  if (motivo) throw rechazo(motivo);
  try {
    await ctx.store.guardarRecepcion(ctx.projectId, actor(ctx), c.id ?? globalThis.crypto.randomUUID(), c);
  } catch (err) {
    throw traducir(err);
  }
  return getRecepciones(ctx);
}

/** Sends, approves, returns or cancels a reception. */
export async function accionRecepcion(ctx: Ctx, id: string, body: unknown): Promise<RecepcionesResponse> {
  const a = leerAccionRecepcion(body);
  const [recepciones, ordenes] = await Promise.all([ctx.store.listRecepciones(ctx.projectId), ctx.store.listOrdenes(ctx.projectId)]);
  const r = recepciones.find((x) => x.id === id);
  if (!r) throw rechazo("no-existe");
  const acc = await requerir(ctx, "recepciones", "ver", `recepciones.${a.accion}`);
  const audit = { objetoTipo: "recepcion", objetoId: r.id, sujetoId: r.elaboradoPorId, sujetoNombre: numeroRecepcion(r.numero) };
  const motivo = revisarAccionRecepcion({ actorId: ctx.caller.id, permisos: acc.permisos, hoy: ctx.hoy }, r, a, ordenes.find((o) => o.id === r.ordenId));
  if (motivo && DENEGACIONES.has(motivo)) return denegar(ctx, `recepciones.${a.accion}`, "recepciones", motivo, audit);
  if (motivo) throw rechazo(motivo);
  try {
    await ctx.store.accionRecepcion(ctx.projectId, actor(ctx), id, a);
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && DENEGACIONES.has(e.code as MotivoRechazo)) await denegar(ctx, `recepciones.${a.accion}`, "recepciones", e.code as MotivoRechazo, audit);
    throw e;
  }
  return getRecepciones(ctx);
}

// ---------------------------------------------------------------- CDE write test

const PASOS_CDE: PasoPruebaCde[] = ["inspeccionar", "crear-carpeta", "iniciar-subida", "estado-subida", "subir-desde-servidor", "duplicado"];
const ID_TRIMBLE = /^[A-Za-z0-9_.:-]{1,200}$/;

/**
 * One step of the test that checks the extension can write to the project's
 * CDE with the caller's token: find or create a test folder in the root,
 * start an upload (the browser sends the content to the signed URL; when it
 * can't, the server does), confirm it, upload again for a new version and
 * check that a duplicate is refused. Nothing is deleted. Documentos: administrar.
 */
export async function pruebaCde(ctx: Ctx, body: unknown): Promise<PruebaCdeResponse> {
  const o = (body ?? {}) as Record<string, unknown>;
  const paso = o.paso as PasoPruebaCde;
  if (!PASOS_CDE.includes(paso)) throw new ServiceError("Paso no válido.", 400, "datos");
  const id = (k: string) => {
    const v = o[k];
    if (typeof v !== "string" || !ID_TRIMBLE.test(v)) throw new ServiceError(`Falta ${k}.`, 400, "datos");
    return v;
  };
  await requerir(ctx, "documentos", "administrar", "cde.prueba");
  if (!ctx.deps.cde) throw new ServiceError("La conexión con Trimble Connect no está disponible.", 503);
  const { cliente, rootId } = await ctx.deps.cde();
  const r = await pasoCde(ctx, cliente, rootId, paso, id);
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id,
    actorNombre: ctx.caller.name,
    accion: "cde.prueba",
    modulo: "documentos",
    objetoTipo: "cde",
    objetoId: CARPETA_PRUEBA,
    sujetoId: null,
    sujetoNombre: "",
    resultado: r.ok ? "ok" : "error",
    detalle: { paso, mensaje: r.mensaje, http: r.datos.http ?? null },
  });
  return r;
}

async function pasoCde(ctx: Ctx, c: ClienteTrimble, rootId: string, paso: PasoPruebaCde, id: (k: string) => string): Promise<PruebaCdeResponse> {
  const responder = (ok: boolean, mensaje: string, datos: Record<string, unknown> = {}): PruebaCdeResponse => ({ paso, ok, mensaje, datos });
  const contenido = () => contenidoPrueba(ctx.caller.name, fechaHora(new Date().toISOString()));
  if (paso === "inspeccionar") {
    const raiz = await leerCarpeta(c, rootId);
    if (!raiz.carpeta) return responder(false, `No se pudo leer la carpeta raíz del proyecto: ${explicarEstado(raiz.respuesta.estado)}`, { http: raiz.respuesta.estado });
    const existente = await buscarEnCarpeta(c, raiz.carpeta.id, CARPETA_PRUEBA, "FOLDER");
    return responder(
      true,
      `Raíz del proyecto leída (tu acceso: ${raiz.carpeta.permiso ?? "sin dato"}). ${existente ? "La carpeta de prueba ya existe de una prueba anterior." : "La carpeta de prueba no existe todavía."}`,
      { raiz: raiz.carpeta, carpetaId: existente?.id ?? null }
    );
  }
  if (paso === "crear-carpeta") {
    const raiz = await leerCarpeta(c, rootId);
    if (!raiz.carpeta) return responder(false, explicarEstado(raiz.respuesta.estado), { http: raiz.respuesta.estado });
    const existente = await buscarEnCarpeta(c, raiz.carpeta.id, CARPETA_PRUEBA, "FOLDER");
    if (existente) return responder(true, "La carpeta de prueba ya existía: no se crea otra.", { carpetaId: existente.id, creada: false });
    const hecha = await crearCarpeta(c, raiz.carpeta, CARPETA_PRUEBA);
    if (!hecha.carpeta) return responder(false, `No se pudo crear la carpeta: ${explicarEstado(hecha.respuesta.estado)}`, { http: hecha.respuesta.estado, respuesta: hecha.respuesta.cuerpo });
    return responder(
      true,
      `Carpeta creada en la raíz (parentId con el ${hecha.con === "versionId" ? "id de versión" : "id"} de la raíz; tu acceso: ${hecha.carpeta.permiso ?? "sin dato"}).`,
      { carpetaId: hecha.carpeta.id, creada: true, con: hecha.con }
    );
  }
  if (paso === "iniciar-subida" || paso === "subir-desde-servidor") {
    const carpetaId = id("carpetaId");
    const existente = await buscarEnCarpeta(c, carpetaId, ARCHIVO_PRUEBA, "FILE");
    const s = await iniciarSubida(c, carpetaId, ARCHIVO_PRUEBA, existente ? { siVersion: existente.versionId ?? undefined } : { soloNuevo: true });
    if (!s.uploadId || !s.url) return responder(false, `Trimble no abrió la subida: ${explicarEstado(s.respuesta.estado)}`, { http: s.respuesta.estado, respuesta: s.respuesta.cuerpo });
    if (paso === "iniciar-subida") {
      return responder(true, existente ? "Subida abierta como versión nueva del archivo existente." : "Subida abierta para un archivo nuevo.", {
        uploadId: s.uploadId,
        url: s.url,
        nuevaVersion: !!existente,
        contenido: contenido(),
      });
    }
    // The server sends the content itself (it never takes a URL from the browser).
    const http = await enviarContenido(s.url, contenido(), ctx.deps.fetch ?? fetch);
    const bien = http >= 200 && http < 300;
    return responder(bien, bien ? "El servidor envió el contenido a la URL firmada de Trimble." : `El servidor no pudo enviar el contenido (respuesta ${http}).`, {
      uploadId: s.uploadId,
      nuevaVersion: !!existente,
      http,
    });
  }
  if (paso === "estado-subida") {
    const s = await estadoSubida(c, id("uploadId"));
    const listo = s.status === "DONE";
    const mensaje = listo
      ? `Trimble confirmó la carga: archivo en la revisión ${s.revision ?? "?"}.`
      : s.status === "ERROR"
        ? `Trimble marcó error: ${s.errorReason ?? ""}`
        : `Estado: ${s.status ?? explicarEstado(s.respuesta.estado)}`;
    return responder(listo || s.status === "UPLOADABLE", mensaje, { status: s.status, fileId: s.fileId, versionId: s.versionId, revision: s.revision, http: s.respuesta.estado });
  }
  // duplicado: a new upload with the same name and "If-None-Match: *" must be refused.
  const s = await iniciarSubida(c, id("carpetaId"), ARCHIVO_PRUEBA, { soloNuevo: true });
  const bloqueado = !s.uploadId || s.respuesta.estado >= 400;
  return responder(
    bloqueado,
    bloqueado
      ? `Trimble rechazó un duplicado con el mismo nombre (respuesta ${s.respuesta.estado}): los reintentos no duplicarán archivos.`
      : "Trimble aceptó abrir otra subida con el mismo nombre aunque se pidió que no: habrá que evitar duplicados de otra forma.",
    { http: s.respuesta.estado }
  );
}

// ---------------------------------------------------------------- documents in the CDE

const ENTIDADES: EntidadDocumento[] = ["requisicion", "cotizacion", "orden", "contrato", "proveedor", "recepcion"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function trimble(ctx: Ctx): Promise<{ cliente: ClienteTrimble; rootId: string }> {
  if (!ctx.deps.cde) throw new ServiceError("La conexión con Trimble Connect no está disponible.", 503);
  return ctx.deps.cde();
}

async function tiposLegales(ctx: Ctx): Promise<{ tipos: TipoDocumentoLegal[]; version: number }> {
  const t = await ctx.store.getTiposDocumento(ctx.projectId);
  return { tipos: t.tipos ?? TIPOS_LEGALES_INICIALES, version: t.version };
}

/** The project's documents the caller can see (of one record, of one kind of record, or all). */
export async function getDocumentos(ctx: Ctx, params: URLSearchParams): Promise<DocumentosResponse> {
  const entidadTipo = params.get("entidadTipo") as EntidadDocumento | null;
  const entidadId = params.get("entidadId");
  if (entidadTipo && !ENTIDADES.includes(entidadTipo)) throw rechazo("datos");
  if (entidadId && !UUID.test(entidadId)) throw rechazo("datos");
  const a = entidadTipo ? await requerir(ctx, MODULO_DE[entidadTipo], "ver", "documentos.consultar") : await requerir(ctx, "documentos", "ver", "documentos.consultar");
  const [documentos, carpetas, tipos] = await Promise.all([
    ctx.store.listDocumentos(ctx.projectId, { entidadTipo: entidadTipo ?? undefined, entidadId: entidadId ?? undefined }),
    ctx.store.listCarpetasCde(ctx.projectId),
    tiposLegales(ctx),
  ]);
  return {
    documentos: documentos.filter((d) => tiene(a.permisos, MODULO_DE[d.entidadTipo], "ver")),
    carpetas,
    tipos: tipos.tipos,
    versionConfig: tipos.version,
    hoy: ctx.hoy,
  };
}

export async function getHistorialDocumento(ctx: Ctx, id: string): Promise<{ historial: SyncEntrada[] }> {
  const d = await documento(ctx, id);
  await requerir(ctx, MODULO_DE[d.entidadTipo], "ver", "documentos.consultar");
  return { historial: await ctx.store.listSync(ctx.projectId, id) };
}

/** What Compras' folders look like in the project now (nothing is created). Documentos: administrar. */
export async function inspeccionarCarpetas(ctx: Ctx): Promise<EstadoCarpetas> {
  await requerir(ctx, "documentos", "administrar", "cde.carpetas");
  return estadoCarpetas(ctx, false);
}

/** Creates the folders that are missing (after the person saw what exists) and saves their ids. */
export async function prepararCarpetas(ctx: Ctx): Promise<EstadoCarpetas> {
  await requerir(ctx, "documentos", "administrar", "cde.carpetas");
  return estadoCarpetas(ctx, true);
}

async function estadoCarpetas(ctx: Ctx, crear: boolean): Promise<EstadoCarpetas> {
  const { cliente, rootId } = await trimble(ctx);
  const raiz = await leerCarpeta(cliente, rootId);
  if (!raiz.carpeta) throw new ServiceError(`No se pudo leer la carpeta raíz del proyecto: ${explicarEstado(raiz.respuesta.estado)}`, 502);
  const guardadas = new Map((await ctx.store.listCarpetasCde(ctx.projectId)).map((c) => [c.clave, c]));
  const ids = new Map<string, string>();
  const salida: EstadoCarpetas["carpetas"] = [];
  const creadas: string[] = [];
  for (const c of CARPETAS) {
    const padreId = c.padre ? ids.get(c.padre) ?? null : raiz.carpeta.id;
    let folderId: string | null = null;
    // The saved one if it is still there; else one with that name where it belongs; else (when asked) a new one.
    const guardada = guardadas.get(c.clave);
    if (guardada && (await leerCarpeta(cliente, guardada.folderId)).carpeta) folderId = guardada.folderId;
    if (!folderId && padreId) folderId = (await buscarEnCarpeta(cliente, padreId, c.nombre, "FOLDER"))?.id ?? null;
    const existe = !!folderId;
    if (!folderId && crear && padreId) {
      const padre = c.padre ? await leerCarpeta(cliente, padreId) : raiz;
      if (!padre.carpeta) throw new ServiceError(`No se pudo leer la carpeta de ${c.nombre}.`, 502);
      const hecha = await crearCarpeta(cliente, padre.carpeta, c.nombre);
      if (!hecha.carpeta) throw new ServiceError(`No se pudo crear "${rutaCarpeta(c.clave)}": ${explicarEstado(hecha.respuesta.estado)}`, 502);
      folderId = hecha.carpeta.id;
      creadas.push(rutaCarpeta(c.clave));
    }
    if (folderId) ids.set(c.clave, folderId);
    if (crear && folderId && guardada?.folderId !== folderId) {
      await ctx.store.guardarCarpetaCde(ctx.projectId, { clave: c.clave, nombre: c.nombre, folderId, ruta: rutaCarpeta(c.clave), creada: "", creadaPor: ctx.caller.name });
    }
    salida.push({ clave: c.clave, nombre: c.nombre, ruta: rutaCarpeta(c.clave), folderId, existe, guardada: crear ? !!folderId : guardada?.folderId === folderId && !!folderId });
  }
  if (crear) {
    await ctx.store.auditar(ctx.projectId, {
      actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "cde.carpetas", modulo: "documentos", objetoTipo: "cde", objetoId: rootId, sujetoId: null, sujetoNombre: "Carpeta raíz del proyecto",
      resultado: "ok", detalle: { creadas, existentes: salida.filter((c) => c.existe).map((c) => c.ruta) },
    });
  }
  return { raiz: { id: raiz.carpeta.id, permiso: raiz.carpeta.permiso }, carpetas: salida };
}

/** The record a document belongs to: that it exists, and the prefix of its files. */
async function registroDe(ctx: Ctx, tipo: EntidadDocumento, id: string): Promise<{ prefijo: string; proveedor?: { nit: string; razonSocial: string } }> {
  if (tipo === "requisicion") {
    const r = (await ctx.store.listRequisiciones(ctx.projectId)).find((x) => x.id === id);
    if (r) return { prefijo: numeroRequisicion(r.numero) };
  } else if (tipo === "cotizacion") {
    const c = (await ctx.store.listCotizaciones(ctx.projectId)).find((x) => x.id === id);
    if (c) return { prefijo: numeroCotizacion(c.numero) };
  } else if (tipo === "orden" || tipo === "contrato") {
    const o = (await ctx.store.listOrdenes(ctx.projectId)).find((x) => x.id === id && x.tipo === tipo);
    if (o) return { prefijo: `${numeroOrden(o.tipo, o.numero)}${o.revision ? ` rev${o.revision}` : ""}` };
  } else if (tipo === "recepcion") {
    const r = (await ctx.store.listRecepciones(ctx.projectId)).find((x) => x.id === id);
    if (r) return { prefijo: numeroRecepcion(r.numero) };
  } else if (tipo === "proveedor") {
    const p = (await ctx.store.listProveedores(ctx.projectId)).find((x) => x.id === id);
    if (p) return { prefijo: nitConDv(p.nit, p.dv), proveedor: { nit: nitConDv(p.nit, p.dv), razonSocial: p.razonSocial } };
  }
  throw rechazo("no-existe");
}

/** The folder a document goes to; a supplier's own one is created the first time. */
async function carpetaPara(ctx: Ctx, cliente: ClienteTrimble, tipo: EntidadDocumento, entidadId: string, proveedor?: { nit: string; razonSocial: string }): Promise<CarpetaCde> {
  const carpetas = new Map((await ctx.store.listCarpetasCde(ctx.projectId)).map((c) => [c.clave, c]));
  const base = carpetas.get(CARPETA_DE[tipo]);
  if (!base) throw rechazo("carpetas-sin-preparar");
  if (tipo !== "proveedor" || !proveedor) return base;
  const clave = `proveedor:${entidadId}`;
  const propia = carpetas.get(clave);
  if (propia) return propia;
  const nombre = carpetaProveedor(proveedor.nit, proveedor.razonSocial);
  let folderId = (await buscarEnCarpeta(cliente, base.folderId, nombre, "FOLDER"))?.id ?? null;
  if (!folderId) {
    const padre = await leerCarpeta(cliente, base.folderId);
    if (!padre.carpeta) throw rechazo("carpetas-sin-preparar");
    const hecha = await crearCarpeta(cliente, padre.carpeta, nombre);
    if (!hecha.carpeta) throw new ServiceError(`No se pudo crear la carpeta del proveedor: ${explicarEstado(hecha.respuesta.estado)}`, 502);
    folderId = hecha.carpeta.id;
  }
  const carpeta: CarpetaCde = { clave, nombre, folderId, ruta: `${base.ruta} / ${nombre}`, creada: "", creadaPor: ctx.caller.name };
  await ctx.store.guardarCarpetaCde(ctx.projectId, carpeta);
  return carpeta;
}

async function documento(ctx: Ctx, id: string): Promise<Documento> {
  if (!UUID.test(id)) throw rechazo("datos");
  const d = (await ctx.store.listDocumentos(ctx.projectId, { id }))[0];
  if (!d) throw rechazo("no-existe");
  return d;
}

async function anotar(ctx: Ctx, documentoId: string, accion: string, ok: boolean, detalle: string) {
  await ctx.store.registrarSync(ctx.projectId, { documentoId, creado: "", por: ctx.caller.name, accion, resultado: ok ? "ok" : "error", detalle });
}

/** Saves a change to a document, or tells that someone else changed it meanwhile. */
async function cambiarDocumento(ctx: Ctx, d: Documento, cambios: Partial<Documento>): Promise<Documento> {
  try {
    const nuevo = await ctx.store.actualizarDocumento(ctx.projectId, d.id, cambios, d.version, actor(ctx));
    if (!nuevo) throw rechazo("version-conflict");
    return nuevo;
  } catch (err) {
    throw traducir(err);
  }
}

function leerNuevoDocumento(body: unknown): NuevoDocumento & { id: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const mal = (m: string): never => {
    throw new ServiceError(m, 400, "datos");
  };
  if (typeof o.id !== "string" || !UUID.test(o.id)) mal("Documento no válido.");
  if (typeof o.entidadTipo !== "string" || !ENTIDADES.includes(o.entidadTipo as EntidadDocumento)) mal("Registro no válido.");
  if (typeof o.entidadId !== "string" || !UUID.test(o.entidadId)) mal("Registro no válido.");
  if (typeof o.tipoDoc !== "string" || !/^[a-z0-9_]{1,40}$/.test(o.tipoDoc)) mal("Tipo de documento no válido.");
  if (typeof o.nombreOriginal !== "string" || !o.nombreOriginal.trim() || o.nombreOriginal.length > 255) mal("Nombre de archivo no válido.");
  if (typeof o.tamano !== "number" || !Number.isInteger(o.tamano) || o.tamano < 0) mal("Tamaño no válido.");
  if (typeof o.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.sha256)) mal("Huella del archivo no válida.");
  if (o.origen !== "cargado" && o.origen !== "generado") mal("Origen no válido.");
  if (o.vence !== null && o.vence !== undefined && (typeof o.vence !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.vence))) mal("Fecha de vencimiento no válida.");
  return {
    id: o.id as string,
    entidadTipo: o.entidadTipo as EntidadDocumento,
    entidadId: o.entidadId as string,
    tipoDoc: o.tipoDoc as string,
    nombreOriginal: (o.nombreOriginal as string).trim(),
    tamano: o.tamano as number,
    sha256: o.sha256 as string,
    origen: o.origen as NuevoDocumento["origen"],
    vence: (o.vence as string | null | undefined) ?? null,
  };
}

/**
 * Registers a document and opens its upload in Trimble: the browser then
 * sends the content to the signed URL (or to /contenido, for small files,
 * when it can't), and asks to confirm. It stays "pendiente" until Trimble
 * confirms. Permission: the record's module, "documentos".
 */
export async function crearDocumento(ctx: Ctx, body: unknown): Promise<SubidaDocumento> {
  const n = leerNuevoDocumento(body);
  const m = MODULO_DE[n.entidadTipo];
  await requerir(ctx, m, "documentos", "documentos.cargar");
  if (n.tamano > MAX_TAMANO) throw rechazo("archivo-grande");
  const { tipos } = await tiposLegales(ctx);
  const tipo = tiposDe(n.entidadTipo, tipos).find((t) => t.clave === n.tipoDoc);
  if (!tipo) throw new ServiceError("Ese tipo de documento no aplica a este registro.", 400, "datos");
  if (n.vence && n.entidadTipo !== "proveedor") throw new ServiceError("Solo los documentos legales de proveedores llevan vencimiento.", 400, "datos");
  const registro = await registroDe(ctx, n.entidadTipo, n.entidadId);
  const { cliente } = await trimble(ctx);
  const carpeta = await carpetaPara(ctx, cliente, n.entidadTipo, n.entidadId, registro.proveedor);
  const d: Documento = {
    ...n,
    titulo: tipo.nombre,
    nombreArchivo: nombreArchivo(registro.prefijo, tipo.nombre, n.nombreOriginal, n.id),
    carpetaId: carpeta.folderId,
    ruta: carpeta.ruta,
    estado: "pendiente",
    uploadId: null,
    fileId: null,
    versionId: null,
    revision: null,
    intentos: 0,
    ultimoError: "",
    subidoPorId: ctx.caller.id,
    subidoPor: ctx.caller.name,
    creado: new Date().toISOString(),
    confirmado: null,
    motivoAnulacion: "",
    version: 1,
  };
  try {
    await ctx.store.crearDocumento(ctx.projectId, d);
  } catch (err) {
    throw traducir(err);
  }
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "documentos.cargar", modulo: m, objetoTipo: n.entidadTipo, objetoId: n.entidadId, sujetoId: null,
    sujetoNombre: registro.prefijo, resultado: "ok", detalle: { documento: d.nombreArchivo, ruta: d.ruta, tamano: d.tamano },
  });
  return abrirSubida(ctx, cliente, d);
}

/** Opens a new upload of a registered document (never a second file: fails if the name already exists). */
async function abrirSubida(ctx: Ctx, cliente: ClienteTrimble, d: Documento): Promise<SubidaDocumento> {
  const s = await iniciarSubida(cliente, d.carpetaId, d.nombreArchivo, { soloNuevo: true });
  if (!s.uploadId || !s.url) {
    const mensaje = `Trimble no abrió la subida: ${explicarEstado(s.respuesta.estado)}`;
    await anotar(ctx, d.id, "abrir subida", false, mensaje);
    return { documento: await cambiarDocumento(ctx, d, { estado: "error", ultimoError: mensaje, intentos: d.intentos + 1 }), url: null };
  }
  await anotar(ctx, d.id, "abrir subida", true, `Subida ${s.uploadId}`);
  return { documento: await cambiarDocumento(ctx, d, { estado: "pendiente", uploadId: s.uploadId, ultimoError: "", intentos: d.intentos + 1 }), url: s.url };
}

/**
 * The server sends the content for the browser (small files only), after
 * checking it is the very file that was registered (same SHA-256).
 */
export async function enviarDocumento(ctx: Ctx, id: string, contenido: Uint8Array): Promise<{ documento: Documento }> {
  const d = await documento(ctx, id);
  await requerir(ctx, MODULO_DE[d.entidadTipo], "documentos", "documentos.cargar");
  if (contenido.byteLength > MAX_RELEVO) throw rechazo("archivo-grande");
  // The fingerprint of the bytes received, computed here: never one sent by the browser.
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", contenido as Uint8Array<ArrayBuffer>));
  if ([...hash].map((b) => b.toString(16).padStart(2, "0")).join("") !== d.sha256) throw rechazo("archivo-distinto");
  if (d.estado !== "pendiente" || !d.uploadId) throw rechazo("estado-no-valido");
  const { cliente } = await trimble(ctx);
  const s = await estadoSubida(cliente, d.uploadId);
  if (s.status !== "UPLOADABLE" || !s.url) throw new ServiceError("La subida ya no recibe el archivo: reinténtala.", 409, "estado-no-valido");
  const http = await enviarContenido(s.url, contenido, ctx.deps.fetch ?? fetch);
  const bien = http >= 200 && http < 300;
  await anotar(ctx, d.id, "enviar desde el servidor", bien, `Respuesta ${http}`);
  if (!bien) throw new ServiceError(`Trimble no recibió el archivo (respuesta ${http}).`, 502);
  return { documento: d };
}

/** Asks Trimble how the upload went; only then is the document "respaldado". */
export async function confirmarDocumento(ctx: Ctx, id: string): Promise<{ documento: Documento }> {
  const d = await documento(ctx, id);
  await requerir(ctx, MODULO_DE[d.entidadTipo], "documentos", "documentos.cargar");
  if (d.estado === "respaldado" || d.estado === "anulado" || !d.uploadId) return { documento: d };
  const { cliente } = await trimble(ctx);
  return { documento: await leerConfirmacion(ctx, cliente, d) };
}

async function leerConfirmacion(ctx: Ctx, cliente: ClienteTrimble, d: Documento): Promise<Documento> {
  const s = await estadoSubida(cliente, d.uploadId!);
  if (s.status === "DONE" && s.fileId && s.versionId) {
    await anotar(ctx, d.id, "confirmar", true, `Revisión ${s.revision ?? "?"}`);
    const listo = await cambiarDocumento(ctx, d, { estado: "respaldado", fileId: s.fileId, versionId: s.versionId, revision: s.revision, confirmado: new Date().toISOString(), ultimoError: "" });
    await ctx.store.auditar(ctx.projectId, {
      actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "documentos.respaldado", modulo: MODULO_DE[d.entidadTipo], objetoTipo: d.entidadTipo, objetoId: d.entidadId,
      sujetoId: null, sujetoNombre: d.nombreArchivo, resultado: "ok", detalle: { ruta: d.ruta, revision: s.revision },
    });
    return listo;
  }
  if (s.status === "ERROR" || s.status === "EXPIRED" || s.respuesta.estado === 404) {
    const mensaje = s.status === "EXPIRED" ? "La subida venció sin recibir el archivo." : s.errorReason || explicarEstado(s.respuesta.estado);
    await anotar(ctx, d.id, "confirmar", false, mensaje);
    return cambiarDocumento(ctx, d, { estado: "error", ultimoError: mensaje });
  }
  return d;
}

/**
 * Retries a document that isn't backed up without making a second file:
 * if Trimble already has it (the upload finished, or a file with its name is
 * there), it is just confirmed; otherwise a new upload is opened.
 */
export async function reintentarDocumento(ctx: Ctx, id: string): Promise<SubidaDocumento> {
  const d = await documento(ctx, id);
  await requerir(ctx, MODULO_DE[d.entidadTipo], "documentos", "documentos.cargar");
  if (d.estado === "respaldado" || d.estado === "anulado") return { documento: d, url: null };
  const { cliente } = await trimble(ctx);
  if (d.uploadId) {
    const s = await estadoSubida(cliente, d.uploadId);
    if (s.status === "DONE") return { documento: await leerConfirmacion(ctx, cliente, d), url: null };
    if (s.status === "UPLOADABLE" && s.url) {
      await anotar(ctx, d.id, "reintentar", true, "La subida abierta todavía recibe el archivo.");
      return { documento: d, url: s.url };
    }
  }
  const existente = await buscarEnCarpeta(cliente, d.carpetaId, d.nombreArchivo, "FILE");
  if (existente?.versionId) {
    await anotar(ctx, d.id, "reintentar", true, "El archivo ya estaba en Trimble: se confirma sin volver a subirlo.");
    const listo = await cambiarDocumento(ctx, d, { estado: "respaldado", fileId: existente.id, versionId: existente.versionId, confirmado: new Date().toISOString(), ultimoError: "" });
    return { documento: listo, url: null };
  }
  return abrirSubida(ctx, cliente, d);
}

/** A short-lived link to open a backed-up document, with the caller's own Trimble permissions. */
export async function abrirDocumento(ctx: Ctx, id: string): Promise<{ url: string }> {
  const d = await documento(ctx, id);
  const m = MODULO_DE[d.entidadTipo];
  await requerir(ctx, m, "documentos", "documentos.abrir");
  if (d.estado !== "respaldado" || !d.fileId) throw new ServiceError("El documento todavía no está respaldado en el CDE.", 409, "estado-no-valido");
  const { cliente } = await trimble(ctx);
  const r = await urlDescarga(cliente, d.fileId, d.versionId);
  if (!r.url) throw new ServiceError(`Trimble no entregó el archivo: ${explicarEstado(r.respuesta.estado)}`, r.respuesta.estado === 403 ? 403 : 502);
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "documentos.abrir", modulo: m, objetoTipo: d.entidadTipo, objetoId: d.entidadId, sujetoId: null,
    sujetoNombre: d.nombreArchivo, resultado: "ok", detalle: {},
  });
  return { url: r.url };
}

/** Cancels a document in Compras (the file stays in Trimble). */
export async function anularDocumento(ctx: Ctx, id: string, body: unknown): Promise<{ documento: Documento }> {
  const d = await documento(ctx, id);
  const m = MODULO_DE[d.entidadTipo];
  await requerir(ctx, m, "documentos", "documentos.anular");
  const motivo = typeof (body as { motivo?: unknown })?.motivo === "string" ? ((body as { motivo: string }).motivo).trim().slice(0, 1000) : "";
  if (!motivo) throw rechazo("motivo-requerido");
  if (d.estado === "anulado") throw rechazo("estado-no-valido");
  const listo = await cambiarDocumento(ctx, d, { estado: "anulado", motivoAnulacion: motivo });
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "documentos.anular", modulo: m, objetoTipo: d.entidadTipo, objetoId: d.entidadId, sujetoId: null,
    sujetoNombre: d.nombreArchivo, resultado: "ok", detalle: { motivo },
  });
  return { documento: listo };
}

/** The kinds of legal documents of suppliers (name, mandatory, days of validity, active). Documentos: administrar. */
export async function guardarTiposDocumento(ctx: Ctx, body: unknown): Promise<DocumentosResponse> {
  const o = (body ?? {}) as { tipos?: unknown; version?: unknown };
  if (!Array.isArray(o.tipos) || typeof o.version !== "number") throw rechazo("datos");
  const tipos: TipoDocumentoLegal[] = o.tipos.map((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    return {
      clave: String(t.clave ?? ""),
      nombre: String(t.nombre ?? "").trim(),
      obligatorio: t.obligatorio === true,
      vigenciaDias: t.vigenciaDias === null || t.vigenciaDias === undefined || t.vigenciaDias === "" ? null : Number(t.vigenciaDias),
      activo: t.activo !== false,
    };
  });
  await requerir(ctx, "documentos", "administrar", "documentos.tipos");
  const antes = await tiposLegales(ctx);
  const problema = revisarTipos(tipos, antes.tipos);
  if (problema) throw new ServiceError(problema, 400, "datos");
  try {
    await ctx.store.guardarTiposDocumento(ctx.projectId, actor(ctx), tipos, o.version);
  } catch (err) {
    throw traducir(err);
  }
  await ctx.store.auditar(ctx.projectId, {
    actorId: ctx.caller.id, actorNombre: ctx.caller.name, accion: "documentos.tipos", modulo: "documentos", objetoTipo: "proyecto", objetoId: ctx.projectId, sujetoId: null,
    sujetoNombre: "", resultado: "ok", detalle: { tipos: tipos.map((t) => `${t.nombre}${t.obligatorio ? " (obligatorio)" : ""}${t.activo ? "" : " (inactivo)"}`) },
  });
  return getDocumentos(ctx, new URLSearchParams());
}
