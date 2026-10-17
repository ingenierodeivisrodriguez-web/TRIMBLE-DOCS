import { fmt } from "../presupuesto/format";
import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { ProjectContacts } from "../propiedades/types";
import { esMotivo, ESTADO_HTTP, estadoAsignacion, MENSAJES, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol, tiene } from "./accesos";
import { esDocumento, insumosPlanificados, metradosDelModelo } from "./planificado";
import type { LecturaPresupuesto } from "./presupuestoLectura";
import { evaluar, razonesJustificacion, revisarComparativo, revisarCotizacion } from "./cotizaciones";
import { comprometidoPorInsumo, comprometidoPorLinea, maximoLinea, numeroOrden, revisarAccionOrden, revisarOrden } from "./ordenes";
import { excesos, limite, numeroRequisicion, puedeEditar, revisarAccion, solicitadoPorInsumo } from "./requisiciones";
import { ROLES_INICIALES } from "./roles";
import type { Actor, ComprasStore, LineaGuardada, OrdenGuardada } from "./store";
import {
  leerAccionOrden,
  leerCambioOrden,
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
  Permiso,
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
  const [plan, requisiciones, ordenes] = await Promise.all([planActual(ctx), ctx.store.listRequisiciones(ctx.projectId), ctx.store.listOrdenes(ctx.projectId)]);
  const pedidos = solicitadoPorInsumo(requisiciones);
  const comprometido = comprometidoPorInsumo(ordenes);
  return {
    ...plan,
    insumos: plan.insumos.map((i) => ({ ...i, solicitado: pedidos.get(i.id)?.solicitado ?? 0, aprobado: pedidos.get(i.id)?.aprobado ?? 0, comprometido: comprometido.get(i.id) ?? 0 })),
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
  const [ordenes, requisiciones, comparativos, cotizaciones] = await Promise.all([
    ctx.store.listOrdenes(ctx.projectId),
    ctx.store.listRequisiciones(ctx.projectId),
    ctx.store.listComparativos(ctx.projectId),
    ctx.store.listCotizaciones(ctx.projectId),
  ]);
  const antes = c.id ? ordenes.find((o) => o.id === c.id) ?? null : null;
  const r = requisiciones.find((x) => x.id === c.requisicionId);
  const comp = comparativos.find((x) => x.requisicionId === c.requisicionId);
  const cot = cotizaciones.find((x) => x.id === comp?.cotizacionElegidaId);
  const audit = { objetoTipo: c.tipo, objetoId: c.id ?? "", sujetoNombre: antes ? numeroOrden(antes.tipo, antes.numero) : r ? numeroRequisicion(r.numero) : "" };
  const motivo = revisarOrden({ actorId: ctx.caller.id, permisos: a.permisos, hoy: ctx.hoy }, c, antes, r, comp, cot, ordenes);
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
  const motivo = revisarAccionOrden({ actorId: ctx.caller.id, permisos: acc.permisos, hoy: ctx.hoy }, o, a);
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
