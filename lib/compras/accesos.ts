import { esPermisoValido } from "./roles";
import { Accion, Asignacion, CambioAsignacion, CambioRol, EstadoAsignacion, Modulo, Permiso, Rol, ROL_ADMIN } from "./types";

/**
 * The access rules of Compras, as pure functions. The SQL functions of
 * supabase/compras.sql check the same ones again (the app's checks give the
 * clear messages; the database's make sure nothing gets around them).
 */

/** Why a change of access was refused (the SQL raises "compras:<code>"). */
export type MotivoRechazo =
  | "sin-acceso"
  | "sin-permiso"
  | "propio"
  | "escalamiento"
  | "rol-no-valido"
  | "rol-protegido"
  | "ultimo-admin"
  | "ya-activo"
  | "no-admin-trimble"
  | "no-miembro"
  | "datos"
  | "nombre-repetido"
  | "version-conflict"
  | "no-existe"
  | "estado-no-valido"
  | "auto-aprobacion"
  | "cantidad-excedida"
  | "exceso-sin-permiso"
  | "cantidad-no-valida"
  | "motivo-requerido"
  | "justificacion-requerida"
  | "sin-lineas"
  | "fecha-pasada"
  | "linea-duplicada"
  | "insumo-no-valido"
  | "requisicion-no-aprobada"
  | "comparativo-cerrado"
  | "proveedor-no-activo"
  | "cotizacion-duplicada"
  | "cotizacion-no-elegible"
  | "nit-repetido"
  | "sin-proveedor-elegido"
  | "doble-compromiso"
  | "objeto-requerido"
  | "con-ordenes";

export const MENSAJES: Record<MotivoRechazo, string> = {
  "sin-acceso": "No tienes acceso a Compras en este proyecto. Pídeselo a un administrador de Compras.",
  "sin-permiso": "Tu rol no permite hacer esto.",
  propio: "Nadie puede cambiar su propio acceso ni el rol que tiene asignado: pídeselo a otro administrador.",
  escalamiento: "Solo puedes dar o cambiar accesos y roles con permisos que tú también tienes.",
  "rol-no-valido": "El rol elegido no existe o está desactivado.",
  "rol-protegido": "El rol Administrador de plataforma siempre tiene todos los permisos, y los roles iniciales no se desactivan.",
  "ultimo-admin": "Debe quedar al menos un Administrador de plataforma vigente y sin fecha final.",
  "ya-activo": "Compras ya está activado en este proyecto: pide acceso a uno de sus administradores.",
  "no-admin-trimble": "Solo un administrador del proyecto en Trimble Connect puede activar Compras.",
  "no-miembro": "La persona no está en el equipo del proyecto en Trimble Connect.",
  datos: "Los datos no son válidos.",
  "nombre-repetido": "Ya hay un rol con ese nombre en este proyecto.",
  "version-conflict": "Otra persona cambió esto mientras lo editabas. Se recargó: revisa y vuelve a guardar.",
  "no-existe": "No existe en este proyecto.",
  "estado-no-valido": "En su estado actual no se puede hacer eso.",
  "auto-aprobacion": "Quien hizo la requisición no puede aprobarla, rechazarla ni devolverla: lo decide otra persona.",
  "cantidad-excedida": "La cantidad pasa lo que queda del presupuesto: escribe la justificación del exceso en esa línea.",
  "exceso-sin-permiso": "Aprobar por encima del presupuesto requiere el permiso “Aprobar sobre el presupuesto”.",
  "cantidad-no-valida": "La cantidad aprobada debe estar entre 0 y la pedida, y al menos una línea debe aprobarse.",
  "motivo-requerido": "Escribe el motivo.",
  "justificacion-requerida": "Escribe para qué se necesita (justificación) antes de enviarla.",
  "sin-lineas": "Agrega al menos un insumo.",
  "fecha-pasada": "La fecha requerida ya pasó: cámbiala antes de enviar.",
  "linea-duplicada": "El mismo insumo (y partida) está dos veces: deja una sola línea.",
  "insumo-no-valido": "Ese insumo no está en el presupuesto del proyecto (o es un porcentaje, que no se compra).",
  "requisicion-no-aprobada": "Solo se cotizan requisiciones aprobadas.",
  "comparativo-cerrado": "El comparativo de esta requisición ya se propuso o aprobó: sus cotizaciones no se cambian (si lo devuelven, se pueden corregir).",
  "proveedor-no-activo": "El proveedor está inactivo o bloqueado.",
  "cotizacion-duplicada": "Ese proveedor ya tiene una cotización para esta requisición: corrígela en vez de registrar otra.",
  "cotizacion-no-elegible": "La cotización elegida está vencida, anulada, es de un proveedor no activo o no es de esta requisición.",
  "nit-repetido": "Ya hay un proveedor con ese NIT en este proyecto.",
  "sin-proveedor-elegido": "La requisición todavía no tiene un proveedor elegido y aprobado en su comparativo.",
  "doble-compromiso": "Esa cantidad ya está comprometida en otra orden o contrato: no se puede ordenar más de lo aprobado y cotizado.",
  "objeto-requerido": "El contrato necesita su objeto (qué se contrata) antes de enviarlo.",
  "con-ordenes": "La requisición tiene órdenes o contratos vigentes: anúlalos primero.",
};

/** The HTTP status of each refusal. */
export const ESTADO_HTTP: Record<MotivoRechazo, number> = {
  "sin-acceso": 403,
  "sin-permiso": 403,
  propio: 403,
  escalamiento: 403,
  "rol-protegido": 403,
  "no-admin-trimble": 403,
  "rol-no-valido": 400,
  "no-miembro": 400,
  datos: 400,
  "ultimo-admin": 409,
  "ya-activo": 409,
  "nombre-repetido": 409,
  "version-conflict": 409,
  "no-existe": 404,
  "estado-no-valido": 409,
  "auto-aprobacion": 403,
  "cantidad-excedida": 409,
  "exceso-sin-permiso": 403,
  "cantidad-no-valida": 400,
  "motivo-requerido": 400,
  "justificacion-requerida": 400,
  "sin-lineas": 400,
  "fecha-pasada": 400,
  "linea-duplicada": 409,
  "insumo-no-valido": 400,
  "requisicion-no-aprobada": 409,
  "comparativo-cerrado": 409,
  "proveedor-no-activo": 409,
  "cotizacion-duplicada": 409,
  "cotizacion-no-elegible": 409,
  "nit-repetido": 409,
  "sin-proveedor-elegido": 409,
  "doble-compromiso": 409,
  "objeto-requerido": 400,
  "con-ordenes": 409,
};

export function esMotivo(text: string): text is MotivoRechazo {
  return Object.prototype.hasOwnProperty.call(MENSAJES, text);
}

/** The state of an access on `hoy` (YYYY-MM-DD). */
export function estadoAsignacion(a: Pick<Asignacion, "activo" | "desde" | "hasta">, hoy: string): EstadoAsignacion {
  if (!a.activo) return "revocada";
  if (a.desde > hoy) return "programada";
  if (a.hasta !== null && a.hasta < hoy) return "vencida";
  return "vigente";
}

/** The permissions a person has today (none without an access in force or with a deactivated role). */
export function permisosVigentes(userId: string, usuarios: Asignacion[], roles: Rol[], hoy: string): Permiso[] {
  const a = usuarios.find((u) => u.userId === userId);
  if (!a || estadoAsignacion(a, hoy) !== "vigente") return [];
  const rol = roles.find((r) => r.id === a.rolId);
  return rol && rol.activo ? rol.permisos : [];
}

export function tiene(permisos: readonly Permiso[], modulo: Modulo, accion: Accion): boolean {
  return permisos.includes(`${modulo}.${accion}` as Permiso);
}

/** Every permission of `parte` is in `todo`. */
export function contenido(parte: readonly string[], todo: readonly string[]): boolean {
  const set = new Set(todo);
  return parte.every((p) => set.has(p));
}

/** Roles someone with `misPermisos` can give: active, and with nothing they don't have themselves. */
export function rolesAsignables(misPermisos: readonly Permiso[], roles: Rol[]): Rol[] {
  return roles.filter((r) => r.activo && contenido(r.permisos, misPermisos));
}

interface Contexto {
  actorId: string;
  misPermisos: readonly Permiso[];
  roles: Rol[];
  usuarios: Asignacion[];
  hoy: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Why giving, changing or revoking this access must be refused, or null if it's allowed. */
export function revisarAsignacion(ctx: Contexto, cambio: CambioAsignacion): MotivoRechazo | null {
  if (!tiene(ctx.misPermisos, "accesos", "administrar")) return "sin-permiso";
  if (cambio.userId === ctx.actorId) return "propio";
  if (!ISO.test(cambio.desde) || (cambio.hasta !== null && (!ISO.test(cambio.hasta) || cambio.hasta < cambio.desde))) return "datos";
  const rol = ctx.roles.find((r) => r.id === cambio.rolId);
  if (!rol || (cambio.activo && !rol.activo)) return "rol-no-valido";
  if (!contenido(rol.permisos, ctx.misPermisos)) return "escalamiento";
  const antes = ctx.usuarios.find((u) => u.userId === cambio.userId);
  if (antes) {
    const rolAntes = ctx.roles.find((r) => r.id === antes.rolId);
    if (rolAntes && !contenido(rolAntes.permisos, ctx.misPermisos)) return "escalamiento";
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";

  const despues: Asignacion[] = [
    ...ctx.usuarios.filter((u) => u.userId !== cambio.userId),
    { ...(antes ?? { nombre: "", email: "", otorgadoPor: "", actualizado: null, actualizadoPor: null }), ...cambio, version: cambio.version + 1 },
  ];
  if (!quedaAdmin(despues, ctx.roles, ctx.hoy)) return "ultimo-admin";
  return null;
}

/** At least one Administrador de plataforma in force today and without an end date. */
export function quedaAdmin(usuarios: Asignacion[], roles: Rol[], hoy: string): boolean {
  const admin = roles.find((r) => r.clave === ROL_ADMIN);
  return !!admin && usuarios.some((u) => u.rolId === admin.id && u.activo && u.hasta === null && u.desde <= hoy);
}

/** Why creating or changing this role must be refused, or null if it's allowed. */
export function revisarRol(ctx: Contexto, cambio: CambioRol): MotivoRechazo | null {
  if (!tiene(ctx.misPermisos, "accesos", "administrar")) return "sin-permiso";
  const nombre = cambio.nombre.trim();
  if (!nombre || nombre.length > 80 || cambio.descripcion.length > 300) return "datos";
  if (!cambio.permisos.every(esPermisoValido)) return "datos";
  const antes = cambio.id ? ctx.roles.find((r) => r.id === cambio.id) : undefined;
  if (antes && (antes.clave === ROL_ADMIN || (antes.sistema && !cambio.activo))) return "rol-protegido";
  const mio = ctx.usuarios.find((u) => u.userId === ctx.actorId);
  if (cambio.id && mio?.rolId === cambio.id) return "propio";
  if (!contenido(cambio.permisos, ctx.misPermisos)) return "escalamiento";
  if (antes) {
    if (!contenido(antes.permisos, ctx.misPermisos)) return "escalamiento";
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";
  return null;
}

/** Can the screen offer to change this person's access (not oneself, nor someone with more permissions). */
export function puedeCambiar(ctx: Pick<Contexto, "actorId" | "misPermisos" | "roles">, a: Asignacion): boolean {
  if (a.userId === ctx.actorId || !tiene(ctx.misPermisos, "accesos", "administrar")) return false;
  const rol = ctx.roles.find((r) => r.id === a.rolId);
  return !rol || contenido(rol.permisos, ctx.misPermisos);
}
