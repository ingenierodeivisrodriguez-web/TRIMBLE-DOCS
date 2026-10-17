import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { ProjectContacts } from "../propiedades/types";
import { esMotivo, ESTADO_HTTP, estadoAsignacion, MENSAJES, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol, tiene } from "./accesos";
import { esDocumento, insumosPlanificados, metradosDelModelo } from "./planificado";
import type { LecturaPresupuesto } from "./presupuestoLectura";
import { ROLES_INICIALES } from "./roles";
import type { Actor, ComprasStore } from "./store";
import { leerCambioAsignacion, leerCambioRol, leerFiltroAuditoria } from "./validate";
import { AccesosResponse, Accion, Asignacion, EntradaAuditoria, EstadoResponse, InsumosResponse, Modulo, Permiso, Rol, ROL_ADMIN } from "./types";

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
export async function getInsumos(ctx: Ctx): Promise<InsumosResponse> {
  await requerir(ctx, "insumos", "ver", "insumos.consultar");
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
