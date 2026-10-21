import { esPermisoValido } from "./roles";
import { Asignacion, CambioAsignacion, CambioRol, EstadoAsignacion, Modulo, Accion, Permiso, Rol, UsuarioEmpresa } from "./types";

/**
 * The access rules of Control de Obra, as pure functions. The SQL functions of
 * supabase/control-obra.sql check the same ones again (the app's checks give
 * the clear messages; the database's make sure nothing gets around them).
 *
 * Administration is kept apart from the operational permissions (doc §10.2):
 * - technical administrator (CONTROL_OBRA_ADMINS): companies, licenses and
 *   the company administrators, nothing inside the projects;
 * - company administrator: people, roles, projects and structure of the company;
 * - project administrator: people and structure of one project.
 * Nobody changes their own access, and nobody creates an administrator of
 * their own level or above.
 */

/** Why something was refused (the SQL raises "obra:<code>"). */
export type MotivoRechazo =
  | "sin-acceso"
  | "sin-permiso"
  | "no-admin"
  | "solo-admin-tecnico"
  | "solo-admin-empresa"
  | "es-administrador"
  | "propio"
  | "rol-no-valido"
  | "rol-protegido"
  | "usuario-inactivo"
  | "no-miembro"
  | "no-admin-trimble"
  | "sin-empresa"
  | "ya-vinculado"
  | "otra-empresa"
  | "licencia-no-vigente"
  | "modulo-no-contratado"
  | "cupo-proyectos"
  | "cupo-usuarios"
  | "datos"
  | "nombre-repetido"
  | "nit-repetido"
  | "correo-repetido"
  | "clave-repetida"
  | "valor-repetido"
  | "nivel-no-valido"
  | "padre-no-valido"
  | "version-conflict"
  | "no-existe"
  | "motivo-requerido"
  | "historial-inmutable"
  | "sin-flujo"
  | "flujo-no-valido"
  | "paso-ajeno"
  | "auto-aprobacion"
  | "estado-no-permite"
  | "fecha-futura"
  | "ubicacion-no-valida"
  | "supera-100"
  | "cantidad-no-valida"
  | "partida-no-valida"
  | "contrato-no-valido"
  | "elemento-no-asociado";

export const MENSAJES: Record<MotivoRechazo, string> = {
  "sin-acceso": "No tienes acceso a Control de Obra en este proyecto. Pídeselo a un administrador.",
  "sin-permiso": "Tu rol no permite hacer esto.",
  "no-admin": "Solo los administradores de la empresa o del proyecto pueden hacer esto.",
  "solo-admin-tecnico": "Solo el administrador técnico del producto puede hacer esto.",
  "solo-admin-empresa": "Solo un administrador de la empresa puede hacer esto.",
  "es-administrador": "Esa persona es administradora: su acceso lo cambia un administrador de nivel superior.",
  propio: "Nadie puede cambiar su propio acceso, su rol ni el rol que tiene asignado: pídeselo a otro administrador.",
  "rol-no-valido": "El rol elegido no existe en la empresa o está desactivado.",
  "rol-protegido": "Los roles iniciales no se desactivan (sí se puede cambiar su matriz).",
  "usuario-inactivo": "La persona está desactivada en la empresa: un administrador de la empresa debe reactivarla primero.",
  "no-miembro": "La persona no está en el equipo del proyecto en Trimble Connect.",
  "no-admin-trimble": "Solo un administrador del proyecto en Trimble Connect puede registrar o retirar el proyecto.",
  "sin-empresa": "Este proyecto no está registrado en ninguna empresa de Control de Obra.",
  "ya-vinculado": "Este proyecto ya está registrado en una empresa.",
  "otra-empresa": "Eso pertenece a otra empresa.",
  "licencia-no-vigente": "La licencia de la empresa no está vigente (vencida, suspendida o aún no empieza). Comunícate con el administrador técnico del producto.",
  "modulo-no-contratado": "La licencia de la empresa no incluye este módulo.",
  "cupo-proyectos": "La licencia de la empresa ya tiene registrados todos los proyectos que permite.",
  "cupo-usuarios": "La licencia de la empresa ya tiene activas todas las personas que permite.",
  datos: "Los datos no son válidos.",
  "nombre-repetido": "Ya hay otro registro con ese nombre.",
  "nit-repetido": "Ya hay una empresa con ese NIT.",
  "correo-repetido": "Ese correo ya está registrado en la empresa.",
  "clave-repetida": "Ya hay un nivel con esa clave.",
  "valor-repetido": "Ese valor ya existe en ese nivel (dentro del mismo valor superior).",
  "nivel-no-valido": "El nivel no existe en este proyecto o está desactivado.",
  "padre-no-valido": "El valor superior no es del nivel superior o crearía un ciclo.",
  "version-conflict": "Otra persona cambió esto mientras lo editabas. Se recargó: revisa y vuelve a guardar.",
  "no-existe": "No existe.",
  "motivo-requerido": "Escribe el motivo.",
  "historial-inmutable": "La bitácora y el historial de licencias no se pueden cambiar ni borrar.",
  "sin-flujo": "Este proyecto no tiene configurado el flujo de aprobación de este documento. Pídeselo a un administrador (pestaña Flujos de aprobación).",
  "flujo-no-valido": "El flujo de aprobación no es válido.",
  "paso-ajeno": "Este paso del flujo lo atiende otro rol.",
  "auto-aprobacion": "Quien elabora un documento no lo aprueba, y una misma persona no firma dos pasos del mismo documento.",
  "estado-no-permite": "El documento no está en un estado que permita esa acción.",
  "fecha-futura": "La fecha no puede ser futura.",
  "ubicacion-no-valida": "La ubicación no es válida: revisa que cada valor exista, esté activo, pertenezca al de arriba y que estén los niveles obligatorios.",
  "supera-100": "Con esta medición, algún elemento pasaría del 100 % medido en esta partida.",
  "cantidad-no-valida": "La cantidad medida debe ser mayor que cero.",
  "partida-no-valida": "La partida no existe en el presupuesto guardado o está desactivada.",
  "contrato-no-valido": "El contrato no está aprobado en Compras o no incluye un insumo de esta partida.",
  "elemento-no-asociado": "Algún elemento no está asociado a esta partida en Presupuesto: asócialo allí o mídelo a mano.",
};

export const ESTADO_HTTP: Record<MotivoRechazo, number> = {
  "sin-acceso": 403,
  "sin-permiso": 403,
  "no-admin": 403,
  "solo-admin-tecnico": 403,
  "solo-admin-empresa": 403,
  "es-administrador": 403,
  propio: 403,
  "rol-no-valido": 400,
  "rol-protegido": 403,
  "usuario-inactivo": 409,
  "no-miembro": 400,
  "no-admin-trimble": 403,
  "sin-empresa": 404,
  "ya-vinculado": 409,
  "otra-empresa": 403,
  "licencia-no-vigente": 403,
  "modulo-no-contratado": 403,
  "cupo-proyectos": 409,
  "cupo-usuarios": 409,
  datos: 400,
  "nombre-repetido": 409,
  "nit-repetido": 409,
  "correo-repetido": 409,
  "clave-repetida": 409,
  "valor-repetido": 409,
  "nivel-no-valido": 400,
  "padre-no-valido": 400,
  "version-conflict": 409,
  "no-existe": 404,
  "motivo-requerido": 400,
  "historial-inmutable": 403,
  "sin-flujo": 409,
  "flujo-no-valido": 400,
  "paso-ajeno": 403,
  "auto-aprobacion": 403,
  "estado-no-permite": 409,
  "fecha-futura": 400,
  "ubicacion-no-valida": 400,
  "supera-100": 409,
  "cantidad-no-valida": 400,
  "partida-no-valida": 400,
  "contrato-no-valido": 400,
  "elemento-no-asociado": 400,
};

export function esMotivo(text: string): text is MotivoRechazo {
  return Object.prototype.hasOwnProperty.call(MENSAJES, text);
}

/** Who acts, and at which administrative levels (the technical administrator only manages companies, licenses and their administrators). */
export interface Actuante {
  actorId: string;
  adminEmpresa: boolean;
  /** Administrator of the project in question. */
  adminProyecto: boolean;
  hoy: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The state of an access on `hoy` (YYYY-MM-DD). */
export function estadoAsignacion(a: Pick<Asignacion, "activo" | "desde" | "hasta">, hoy: string): EstadoAsignacion {
  if (!a.activo) return "revocada";
  if (a.desde > hoy) return "programada";
  if (a.hasta !== null && a.hasta < hoy) return "vencida";
  return "vigente";
}

/** The person of the company with this Trimble user id. */
export function usuarioDe(usuarios: UsuarioEmpresa[], userId: string): UsuarioEmpresa | undefined {
  return usuarios.find((u) => u.userId === userId);
}

/** The access in force of a person in a project (none if they are deactivated in the company). */
export function asignacionVigente(userId: string, asignaciones: Asignacion[], usuarios: UsuarioEmpresa[], hoy: string): Asignacion | null {
  const u = usuarioDe(usuarios, userId);
  if (!u || !u.activo) return null;
  const a = asignaciones.find((x) => x.userId === userId);
  return a && estadoAsignacion(a, hoy) === "vigente" ? a : null;
}

/** The operational permissions a person has today in a project (before cutting them to the license). */
export function permisosVigentes(userId: string, asignaciones: Asignacion[], usuarios: UsuarioEmpresa[], roles: Rol[], hoy: string): Permiso[] {
  const a = asignacionVigente(userId, asignaciones, usuarios, hoy);
  if (!a) return [];
  const rol = roles.find((r) => r.id === a.rolId);
  return rol && rol.activo ? rol.permisos : [];
}

/** Administrator of a project today: flag on an access in force, being active in the company. */
export function esAdminProyecto(userId: string, asignaciones: Asignacion[], usuarios: UsuarioEmpresa[], hoy: string): boolean {
  return !!asignacionVigente(userId, asignaciones, usuarios, hoy)?.adminProyecto;
}

export function esAdminEmpresa(userId: string, usuarios: UsuarioEmpresa[]): boolean {
  const u = usuarioDe(usuarios, userId);
  return !!u && u.activo && u.adminEmpresa;
}

export function tiene(permisos: readonly Permiso[], modulo: Modulo, accion: Accion): boolean {
  return permisos.includes(`${modulo}.${accion}` as Permiso);
}

/** Every element of `parte` is in `todo`. */
export function contenido(parte: readonly string[], todo: readonly string[]): boolean {
  const set = new Set(todo);
  return parte.every((p) => set.has(p));
}

interface DatosAsignacion {
  roles: Rol[];
  usuarios: UsuarioEmpresa[];
  /** The accesses of this project. */
  asignaciones: Asignacion[];
}

/** Why giving, changing or revoking this access must be refused, or null if it's allowed. */
export function revisarAsignacion(quien: Actuante, d: DatosAsignacion, cambio: CambioAsignacion): MotivoRechazo | null {
  if (!quien.adminEmpresa && !quien.adminProyecto) return "no-admin";
  if (cambio.userId === quien.actorId) return "propio";
  if (!ISO.test(cambio.desde) || (cambio.hasta !== null && (!ISO.test(cambio.hasta) || cambio.hasta < cambio.desde))) return "datos";
  const rol = d.roles.find((r) => r.id === cambio.rolId);
  if (!rol || (cambio.activo && !rol.activo)) return "rol-no-valido";
  const persona = usuarioDe(d.usuarios, cambio.userId);
  if (persona && !persona.activo && cambio.activo) return "usuario-inactivo";
  const antes = d.asignaciones.find((a) => a.userId === cambio.userId);
  // A project administrator manages the people of the project, not other project administrators; it may give
  // the company administrator an operational role (nobody gives one to themselves).
  if (!quien.adminEmpresa) {
    if (cambio.adminProyecto) return "solo-admin-empresa";
    if (antes?.adminProyecto) return "es-administrador";
  }
  if (antes) {
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";
  return null;
}

/** Can the screen offer to change this access (not one's own, nor another project administrator's from below). */
export function puedeCambiarAsignacion(quien: Actuante, a: Asignacion): boolean {
  if (a.userId === quien.actorId) return false;
  if (quien.adminEmpresa) return true;
  return quien.adminProyecto && !a.adminProyecto;
}

/** Why creating or changing this role must be refused, or null. `misRoles`: roles the actor holds in any project of the company. */
export function revisarRol(quien: Actuante, roles: Rol[], misRoles: ReadonlySet<string>, cambio: CambioRol): MotivoRechazo | null {
  if (!quien.adminEmpresa) return "solo-admin-empresa";
  const nombre = cambio.nombre.trim();
  if (!nombre || nombre.length > 80 || cambio.descripcion.length > 300) return "datos";
  if (!cambio.permisos.every(esPermisoValido) || new Set(cambio.permisos).size !== cambio.permisos.length) return "datos";
  const antes = cambio.id ? roles.find((r) => r.id === cambio.id) : undefined;
  if (cambio.id && !antes) return "no-existe";
  if (antes?.sistema && !cambio.activo) return "rol-protegido";
  // Changing the role one holds would change one's own permissions.
  if (cambio.id && misRoles.has(cambio.id)) return "propio";
  if (roles.some((r) => r.id !== cambio.id && r.nombre.trim().toLowerCase() === nombre.toLowerCase())) return "nombre-repetido";
  if (antes) {
    if (antes.version !== cambio.version) return "version-conflict";
  } else if (cambio.version !== 0) return "version-conflict";
  return null;
}

/** Why (de)activating a person in the whole company must be refused, or null. */
export function revisarUsuarioEmpresa(quien: Actuante, usuarios: UsuarioEmpresa[], id: string, activo: boolean, version: number): MotivoRechazo | null {
  if (!quien.adminEmpresa) return "solo-admin-empresa";
  const u = usuarios.find((x) => x.id === id);
  if (!u) return "no-existe";
  if (u.userId === quien.actorId) return "propio";
  // Company administrators are named and removed by the technical administrator.
  if (u.adminEmpresa) return "es-administrador";
  if (u.version !== version) return "version-conflict";
  if (u.activo === activo) return "datos";
  return null;
}

/** Would giving `userId` an access go over the people the license allows? */
export function superaCupoUsuarios(usuarios: UsuarioEmpresa[], userId: string, maxUsuarios: number): boolean {
  const ya = usuarioDe(usuarios, userId);
  if (ya?.activo) return false;
  return usuarios.filter((u) => u.activo).length + 1 > maxUsuarios;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esCorreo(email: string): boolean {
  return CORREO.test(email) && email.length <= 254;
}

/** The people who can give accesses in a project, for "ask them" on the no-access screen. */
export function administradoresDe(usuarios: UsuarioEmpresa[], asignaciones: Asignacion[], hoy: string): string[] {
  const empresa = usuarios.filter((u) => u.activo && u.adminEmpresa).map((u) => u.nombre || u.email);
  const proyecto = asignaciones
    .filter((a) => a.adminProyecto && asignacionVigente(a.userId, asignaciones, usuarios, hoy))
    .map((a) => a.nombre || a.email);
  return [...new Set([...empresa, ...proyecto])];
}
