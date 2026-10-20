import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import type { ProjectContacts } from "../propiedades/types";
import {
  Actuante,
  administradoresDe,
  asignacionVigente,
  esAdminEmpresa,
  esAdminProyecto,
  esMotivo,
  ESTADO_HTTP,
  MENSAJES,
  MotivoRechazo,
  revisarAsignacion,
  revisarRol,
  revisarUsuarioEmpresa,
  superaCupoUsuarios,
  tiene,
  usuarioDe,
} from "./accesos";
import { cadenaDe } from "./bitacora";
import { nivelesEfectivos, revisarNivel, revisarNodo } from "./estructura";
import { estadoLicencia, licenciaPermiteTrabajar, licenciaVigente, modulosHabilitados, permisosContratados, revisarLicencia } from "./licencias";
import { ROLES_INICIALES } from "./roles";
import type { Actor, Alcance, ObraStore } from "./store";
import {
  AccesosResponse,
  Accion,
  Asignacion,
  Empresa,
  EmpresasResponse,
  EntradaBitacora,
  EstadoLicencia,
  EstadoResponse,
  EstructuraResponse,
  Licencia,
  Modulo,
  NIVELES_INICIALES,
  NuevaEntrada,
  Permiso,
  ProyectoEmpresa,
  Rol,
  UsuarioEmpresa,
  VerificacionBitacora,
} from "./types";
import {
  leerAdminEmpresa,
  leerCambioAsignacion,
  leerCambioEmpresa,
  leerCambioNivel,
  leerCambioNodo,
  leerCambioRol,
  leerCambioUsuario,
  leerConfig,
  leerEmpresaOpcional,
  leerFiltroBitacora,
  leerMotivo,
  leerNuevaLicencia,
  leerVincular,
} from "./validate";

/** Everything an operation needs: who calls, in which project, and today (Colombia). */
export interface Ctx {
  projectId: string;
  /** Validated against Trimble Connect: a member of the project (isAdmin: ADMIN of the project in Trimble). */
  caller: Caller;
  /** Listed in CONTROL_OBRA_ADMINS (Vercel). */
  esAdminTecnico: boolean;
  store: ObraStore;
  /** YYYY-MM-DD in Colombia. */
  hoy: string;
  deps: {
    /** The project's team in Trimble Connect. */
    contactos: () => Promise<ProjectContacts>;
    /** The project's name in Trimble Connect. */
    projectName: () => Promise<string>;
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

/** What the caller is in this project's company, read on every request (no cache: a revoked access stops at once). */
interface Contexto {
  proyecto: ProyectoEmpresa | null;
  empresa: Empresa | null;
  licencia: Licencia | null;
  estado: EstadoLicencia;
  diasRestantes: number | null;
  /** The license lets the company work today. */
  trabaja: boolean;
  alcance: Alcance | null;
  roles: Rol[];
  usuarios: UsuarioEmpresa[];
  /** The accesses of this project. */
  asignaciones: Asignacion[];
  adminEmpresa: boolean;
  adminProyecto: boolean;
  /** Operational permissions in this project, cut to the license. */
  permisos: Permiso[];
  modulos: Set<Modulo>;
}

async function cargar(ctx: Ctx): Promise<Contexto> {
  const proyecto = await ctx.store.proyectoActivo(ctx.projectId);
  if (!proyecto) {
    return {
      proyecto: null, empresa: null, licencia: null, estado: "sin-licencia", diasRestantes: null, trabaja: false, alcance: null,
      roles: [], usuarios: [], asignaciones: [], adminEmpresa: false, adminProyecto: false, permisos: [], modulos: new Set(),
    };
  }
  const alcance: Alcance = { empresaId: proyecto.empresaId, projectId: ctx.projectId };
  const [empresa, licencias, roles, usuarios, asignaciones] = await Promise.all([
    ctx.store.getEmpresa(alcance.empresaId),
    ctx.store.listLicencias(alcance.empresaId),
    ctx.store.listRoles(alcance.empresaId),
    ctx.store.listUsuarios(alcance.empresaId),
    ctx.store.listAsignaciones(alcance),
  ]);
  const licencia = licenciaVigente(licencias);
  const { estado, diasRestantes } = estadoLicencia(licencia, !!empresa?.activa, ctx.hoy);
  const trabaja = licenciaPermiteTrabajar(estado);
  const yo = ctx.caller.id;
  const asignacion = trabaja ? asignacionVigente(yo, asignaciones, usuarios, ctx.hoy) : null;
  const rol = asignacion && roles.find((r) => r.id === asignacion.rolId && r.activo);
  return {
    proyecto,
    empresa,
    licencia,
    estado,
    diasRestantes,
    trabaja,
    alcance,
    roles,
    usuarios,
    asignaciones,
    adminEmpresa: trabaja && esAdminEmpresa(yo, usuarios),
    adminProyecto: trabaja && esAdminProyecto(yo, asignaciones, usuarios, ctx.hoy),
    permisos: rol ? permisosContratados(rol.permisos, licencia?.grupos ?? []) : [],
    modulos: modulosHabilitados(licencia?.grupos ?? []),
  };
}

async function registrar(ctx: Ctx, c: Pick<Contexto, "empresa"> | null, e: Partial<NuevaEntrada> & Pick<NuevaEntrada, "accion" | "modulo" | "resultado">) {
  await ctx.store.registrar({
    empresaId: c?.empresa?.id ?? null,
    projectId: ctx.projectId,
    actorId: ctx.caller.id,
    actorNombre: ctx.caller.name,
    objetoTipo: "",
    objetoId: "",
    cambios: {},
    motivo: "",
    origen: "menu",
    ...e,
  });
}

/** Records the refused attempt in the bitácora (also the denied ones, doc §8) and refuses. */
async function denegar(ctx: Ctx, c: Pick<Contexto, "empresa"> | null, accion: string, modulo: string, motivo: MotivoRechazo, extra: Partial<NuevaEntrada> = {}): Promise<never> {
  await registrar(ctx, c, { accion, modulo, resultado: "denegado", ...extra, cambios: { motivo, ...(extra.cambios ?? {}) } });
  throw rechazo(motivo);
}

/** Runs a change in the store; a refusal of the database (someone changed something meanwhile) is recorded as well. */
async function guardando<T>(ctx: Ctx, c: Pick<Contexto, "empresa"> | null, accion: string, modulo: string, fn: () => Promise<T>, extra: Partial<NuevaEntrada> = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = traducir(err);
    if (e instanceof ServiceError && e.code && esMotivo(e.code) && !["version-conflict", "datos", "nombre-repetido", "clave-repetida", "valor-repetido"].includes(e.code)) {
      await registrar(ctx, c, { accion, modulo, resultado: "denegado", ...extra, cambios: { motivo: e.code, ...(extra.cambios ?? {}) } });
    }
    throw e;
  }
}

/** The project must belong to a company whose license is in force. */
async function enEmpresa(ctx: Ctx, que: string, modulo: string): Promise<Contexto & { alcance: Alcance; empresa: Empresa }> {
  const c = await cargar(ctx);
  if (!c.alcance || !c.empresa) throw rechazo("sin-empresa");
  if (!c.trabaja) return denegar(ctx, c, que, modulo, "licencia-no-vigente");
  return c as Contexto & { alcance: Alcance; empresa: Empresa };
}

/** Denies by default: without this permission (or with the module out of the license), the attempt is recorded and refused. */
export async function requerir(ctx: Ctx, modulo: Modulo, accion: Accion, que: string) {
  const c = await enEmpresa(ctx, que, modulo);
  if (!c.modulos.has(modulo)) return denegar(ctx, c, que, modulo, "modulo-no-contratado");
  if (!c.permisos.length && !c.adminEmpresa && !c.adminProyecto) return denegar(ctx, c, que, modulo, "sin-acceso", { cambios: { permiso: `${modulo}.${accion}` } });
  if (!tiene(c.permisos, modulo, accion)) return denegar(ctx, c, que, modulo, "sin-permiso", { cambios: { permiso: `${modulo}.${accion}` } });
  return c;
}

/** Company or project administrator of this project. */
async function requerirAdmin(ctx: Ctx, que: string, modulo: string) {
  const c = await enEmpresa(ctx, que, modulo);
  if (!c.adminEmpresa && !c.adminProyecto) return denegar(ctx, c, que, modulo, "no-admin");
  return c;
}

const actuante = (ctx: Ctx, c: Contexto): Actuante => ({ actorId: ctx.caller.id, adminEmpresa: c.adminEmpresa, adminProyecto: c.adminProyecto, hoy: ctx.hoy });

/** "Ana Gómez (ana@obra.co)" -> "Ana Gómez". */
const sinCorreo = (name: string) => name.replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim() || name;

// ---------------------------------------------------------------- state

export async function getEstado(ctx: Ctx): Promise<EstadoResponse> {
  let c = await cargar(ctx);
  const yo = (await ctx.deps.contactos()).users.find((u) => u.id === ctx.caller.id);
  const email = yo?.email?.trim().toLowerCase() ?? "";
  // An administrator invited by e-mail is tied to their Trimble user the first time they come in.
  if (email && (await ctx.store.vincularUsuario(email, ctx.caller.id, yo?.name || sinCorreo(ctx.caller.name))) > 0) c = await cargar(ctx);

  const asignacion = c.trabaja ? asignacionVigente(ctx.caller.id, c.asignaciones, c.usuarios, ctx.hoy) : null;
  const rol = asignacion && c.roles.find((r) => r.id === asignacion.rolId);
  const acceso = asignacion && rol && c.permisos.length ? { rol: { id: rol.id, nombre: rol.nombre }, desde: asignacion.desde, hasta: asignacion.hasta, permisos: c.permisos } : null;

  // An unregistered project can be registered by an administrator of a company who is also ADMIN of it in Trimble.
  const puedeVincularA: { id: string; nombre: string }[] = [];
  if (!c.proyecto && ctx.caller.isAdmin) {
    for (const m of await ctx.store.membresias(ctx.caller.id)) {
      if (!m.usuario.activo || !m.usuario.adminEmpresa) continue;
      const lic = licenciaVigente(await ctx.store.listLicencias(m.empresa.id));
      if (licenciaPermiteTrabajar(estadoLicencia(lic, m.empresa.activa, ctx.hoy).estado)) puedeVincularA.push({ id: m.empresa.id, nombre: m.empresa.nombre });
    }
  }

  if (c.proyecto && !acceso && !c.adminEmpresa && !c.adminProyecto && !ctx.esAdminTecnico) {
    // Every attempt to get in without an access is recorded (the technical administrator comes for its own tab).
    await registrar(ctx, c, {
      accion: "ingreso",
      modulo: "accesos",
      objetoTipo: "proyecto",
      objetoId: ctx.projectId,
      resultado: "denegado",
      cambios: { motivo: c.trabaja ? "sin-acceso" : "licencia-no-vigente", licencia: c.estado },
    });
  }

  return {
    projectId: ctx.projectId,
    user: { id: ctx.caller.id, name: yo?.name || sinCorreo(ctx.caller.name), email },
    esAdminTecnico: ctx.esAdminTecnico,
    esAdminTrimble: ctx.caller.isAdmin,
    empresa: c.empresa ? { id: c.empresa.id, nombre: c.empresa.nombre } : null,
    licencia: c.empresa ? { estado: c.estado, hasta: c.licencia?.hasta ?? null, diasRestantes: c.diasRestantes, grupos: c.licencia?.grupos ?? [], plan: c.licencia?.plan ?? "" } : null,
    adminEmpresa: c.adminEmpresa,
    adminProyecto: c.adminProyecto,
    acceso,
    puedeVincularA,
    administradores: c.proyecto ? administradoresDe(c.usuarios, c.asignaciones, ctx.hoy) : [],
    hoy: ctx.hoy,
  };
}

// ---------------------------------------------------------------- the project in a company

/** Registers this project in a company: an administrator of the company who is ADMIN of the project in Trimble. */
export async function vincular(ctx: Ctx, body: unknown): Promise<EstadoResponse> {
  const { empresaId } = leerVincular(body);
  const c = await cargar(ctx);
  if (c.proyecto) throw rechazo("ya-vinculado");
  const destino = { empresa: { id: empresaId } as Empresa };
  const audit = { objetoTipo: "proyecto", objetoId: ctx.projectId };
  const mia = (await ctx.store.membresias(ctx.caller.id)).find((m) => m.empresa.id === empresaId);
  // Attempts on a company one doesn't belong to go to the technical administrator's chain.
  const cadena = mia ? destino : null;
  if (!ctx.caller.isAdmin) return denegar(ctx, cadena, "proyecto.vincular", "accesos", "no-admin-trimble", audit);
  if (!mia || !mia.usuario.activo || !mia.usuario.adminEmpresa) return denegar(ctx, cadena, "proyecto.vincular", "accesos", "solo-admin-empresa", audit);
  const nombre = await ctx.deps.projectName().catch(() => "");
  // A refusal of the database (license, quota) goes to the company's chain.
  await guardando(ctx, destino, "proyecto.vincular", "accesos", () => ctx.store.vincularProyecto(empresaId, ctx.projectId, nombre, actor(ctx)), audit);
  return getEstado(ctx);
}

/** Takes the project out of its company (with a reason): its data stays. */
export async function desvincular(ctx: Ctx, body: unknown): Promise<EstadoResponse> {
  const motivo = leerMotivo(body);
  const c = await enEmpresa(ctx, "proyecto.desvincular", "accesos");
  const audit = { objetoTipo: "proyecto", objetoId: ctx.projectId };
  if (!c.adminEmpresa) return denegar(ctx, c, "proyecto.desvincular", "accesos", "solo-admin-empresa", audit);
  if (!ctx.caller.isAdmin) return denegar(ctx, c, "proyecto.desvincular", "accesos", "no-admin-trimble", audit);
  await guardando(ctx, c, "proyecto.desvincular", "accesos", () => ctx.store.desvincularProyecto(c.alcance, actor(ctx), motivo), audit);
  return getEstado(ctx);
}

// ---------------------------------------------------------------- people and roles

async function respuestaAccesos(ctx: Ctx, c: Contexto & { alcance: Alcance }): Promise<AccesosResponse> {
  const [proyectos] = await Promise.all([c.adminEmpresa ? ctx.store.listProyectos(c.alcance.empresaId) : Promise.resolve([])]);
  const asignados = new Set(c.asignaciones.map((a) => a.userId));
  return {
    roles: c.roles,
    // The company's people are seen whole by its administrators; others, only those of this project.
    usuarios: c.adminEmpresa ? c.usuarios : c.usuarios.filter((u) => u.userId && asignados.has(u.userId)),
    asignaciones: c.asignaciones,
    misPermisos: c.permisos,
    adminEmpresa: c.adminEmpresa,
    adminProyecto: c.adminProyecto,
    proyectos,
    licencia:
      (c.adminEmpresa || c.adminProyecto) && c.licencia
        ? {
            maxUsuarios: c.licencia.maxUsuarios,
            maxProyectos: c.licencia.maxProyectos,
            usuariosActivos: c.usuarios.filter((u) => u.activo).length,
            proyectosActivos: proyectos.filter((p) => p.activo).length,
          }
        : null,
    hoy: ctx.hoy,
  };
}

export async function getAccesos(ctx: Ctx): Promise<AccesosResponse> {
  const c = await enEmpresa(ctx, "accesos.consultar", "accesos");
  if (!c.adminEmpresa && !c.adminProyecto && !tiene(c.permisos, "accesos", "ver")) {
    return denegar(ctx, c, "accesos.consultar", "accesos", c.permisos.length ? "sin-permiso" : "sin-acceso");
  }
  return respuestaAccesos(ctx, c);
}

/** The project's people in Trimble Connect, to choose whom to give an access. */
export async function getContactos(ctx: Ctx): Promise<ProjectContacts> {
  await requerirAdmin(ctx, "accesos.contactos", "accesos");
  const { users } = await ctx.deps.contactos();
  return { users, groups: [] };
}

/** Gives, changes or revokes one person's role in this project. */
export async function guardarAsignacion(ctx: Ctx, body: unknown): Promise<AccesosResponse> {
  const cambio = leerCambioAsignacion(body);
  const c = await requerirAdmin(ctx, "accesos.guardar", "accesos");
  const audit = { objetoTipo: "usuario", objetoId: cambio.userId };
  const motivo = revisarAsignacion(actuante(ctx, c), c, cambio);
  if (motivo === "version-conflict") throw rechazo(motivo);
  if (motivo) return denegar(ctx, c, "accesos.guardar", "accesos", motivo, audit);
  // Accesses are given to members of the project; revoking works even for someone who left it.
  const antes = c.asignaciones.find((a) => a.userId === cambio.userId);
  const contacto = (await ctx.deps.contactos()).users.find((u) => u.id === cambio.userId);
  if (!contacto && cambio.activo) return denegar(ctx, c, "accesos.guardar", "accesos", "no-miembro", audit);
  const persona = { nombre: contacto?.name ?? antes?.nombre ?? cambio.userId, email: contacto?.email ?? antes?.email ?? usuarioDe(c.usuarios, cambio.userId)?.email ?? "" };
  if (cambio.activo && c.licencia && superaCupoUsuarios(c.usuarios, cambio.userId, c.licencia.maxUsuarios)) {
    // An invitation by e-mail already counts: tying it doesn't add a person.
    const invitado = c.usuarios.some((u) => u.userId === null && u.activo && u.email === persona.email.toLowerCase());
    if (!invitado) return denegar(ctx, c, "accesos.guardar", "accesos", "cupo-usuarios", audit);
  }
  await guardando(ctx, c, "accesos.guardar", "accesos", () => ctx.store.guardarAsignacion(c.alcance, actor(ctx), persona, cambio), audit);
  return getAccesos(ctx);
}

/** Creates or changes a role of the company (company administrators). */
export async function guardarRol(ctx: Ctx, body: unknown): Promise<AccesosResponse> {
  const cambio = leerCambioRol(body);
  const c = await requerirAdmin(ctx, "roles.guardar", "accesos");
  const audit = { objetoTipo: "rol", objetoId: cambio.id ?? "", cambios: { nombre: cambio.nombre } };
  const misRoles = new Set((await ctx.store.asignacionesDe(c.alcance.empresaId, ctx.caller.id)).filter((a) => a.activo).map((a) => a.rolId));
  const motivo = revisarRol(actuante(ctx, c), c.roles, misRoles, cambio);
  if (motivo === "version-conflict" || motivo === "datos" || motivo === "nombre-repetido") throw rechazo(motivo);
  if (motivo) return denegar(ctx, c, "roles.guardar", "accesos", motivo, audit);
  await guardando(ctx, c, "roles.guardar", "accesos", () => ctx.store.guardarRol(c.alcance.empresaId, actor(ctx), { ...cambio, id: cambio.id ?? globalThis.crypto.randomUUID() }), audit);
  return getAccesos(ctx);
}

/** (De)activates a person in the whole company (company administrators). */
export async function guardarUsuario(ctx: Ctx, body: unknown): Promise<AccesosResponse> {
  const { id, activo, version } = leerCambioUsuario(body);
  const c = await requerirAdmin(ctx, "usuarios.guardar", "accesos");
  const audit = { objetoTipo: "usuario", objetoId: id };
  const motivo = revisarUsuarioEmpresa(actuante(ctx, c), c.usuarios, id, activo, version);
  if (motivo === "version-conflict" || motivo === "datos") throw rechazo(motivo);
  if (motivo) return denegar(ctx, c, "usuarios.guardar", "accesos", motivo, audit);
  await guardando(ctx, c, "usuarios.guardar", "accesos", () => ctx.store.guardarUsuario(c.alcance.empresaId, actor(ctx), id, activo, version), audit);
  return getAccesos(ctx);
}

// ---------------------------------------------------------------- structure and settings

async function respuestaEstructura(ctx: Ctx, c: Contexto & { alcance: Alcance }): Promise<EstructuraResponse> {
  const [plantilla, propios, nodos, config] = await Promise.all([
    ctx.store.listPlantilla(c.alcance.empresaId),
    ctx.store.listNivelesProyecto(c.alcance),
    ctx.store.listNodos(c.alcance),
    ctx.store.getConfig(c.alcance),
  ]);
  return {
    niveles: nivelesEfectivos(plantilla, propios),
    plantilla,
    propios,
    nodos,
    config,
    puedeEditarProyecto: c.adminEmpresa || c.adminProyecto,
    puedeEditarPlantilla: c.adminEmpresa,
  };
}

export async function getEstructura(ctx: Ctx): Promise<EstructuraResponse> {
  const c = await enEmpresa(ctx, "estructura.consultar", "estructura");
  if (!c.modulos.has("estructura")) return denegar(ctx, c, "estructura.consultar", "estructura", "modulo-no-contratado");
  if (!c.adminEmpresa && !c.adminProyecto && !tiene(c.permisos, "estructura", "ver")) {
    return denegar(ctx, c, "estructura.consultar", "estructura", c.permisos.length ? "sin-permiso" : "sin-acceso");
  }
  return respuestaEstructura(ctx, c);
}

async function requerirEstructura(ctx: Ctx, que: string) {
  const c = await requerirAdmin(ctx, que, "estructura");
  if (!c.modulos.has("estructura")) return denegar(ctx, c, que, "estructura", "modulo-no-contratado");
  return c;
}

/** A level of the company's template (company administrators) or of this project. */
export async function guardarNivel(ctx: Ctx, body: unknown): Promise<EstructuraResponse> {
  const { plantilla: dePlantilla, ...cambio } = leerCambioNivel(body);
  const c = await requerirEstructura(ctx, "estructura.guardar");
  const audit = { objetoTipo: "nivel", objetoId: cambio.clave };
  if (dePlantilla && !c.adminEmpresa) return denegar(ctx, c, "estructura.guardar", "estructura", "solo-admin-empresa", audit);
  const [plantilla, propios] = await Promise.all([ctx.store.listPlantilla(c.alcance.empresaId), ctx.store.listNivelesProyecto(c.alcance)]);
  const projectId = dePlantilla ? null : ctx.projectId;
  const motivo = revisarNivel({ ...cambio, projectId }, dePlantilla ? plantilla : propios, dePlantilla ? plantilla.filter((n) => n.activo) : nivelesEfectivos(plantilla, propios));
  if (motivo) throw rechazo(motivo);
  await guardando(ctx, c, "estructura.guardar", "estructura", () =>
    ctx.store.guardarNivel(c.alcance.empresaId, projectId, actor(ctx), { ...cambio, projectId, id: cambio.id ?? globalThis.crypto.randomUUID() }), audit);
  return respuestaEstructura(ctx, c);
}

/** A value of a level in this project ("Torre 1") with its person in charge, dates and state. */
export async function guardarNodo(ctx: Ctx, body: unknown): Promise<EstructuraResponse> {
  const cambio = leerCambioNodo(body);
  const c = await requerirEstructura(ctx, "estructura.guardar");
  const [plantilla, propios, nodos] = await Promise.all([ctx.store.listPlantilla(c.alcance.empresaId), ctx.store.listNivelesProyecto(c.alcance), ctx.store.listNodos(c.alcance)]);
  const motivo = revisarNodo(cambio, nivelesEfectivos(plantilla, propios), nodos);
  if (motivo) throw rechazo(motivo);
  if (cambio.responsableId && !(await ctx.deps.contactos()).users.some((u) => u.id === cambio.responsableId)) throw rechazo("no-miembro");
  await guardando(ctx, c, "estructura.guardar", "estructura", () => ctx.store.guardarNodo(c.alcance, actor(ctx), { ...cambio, id: cambio.id ?? globalThis.crypto.randomUUID() }), {
    objetoTipo: "nodo",
    objetoId: cambio.id ?? "",
  });
  return respuestaEstructura(ctx, c);
}

/** The project's settings: technical quality lead, tolerance, "aceptado con observaciones". */
export async function guardarConfig(ctx: Ctx, body: unknown): Promise<EstructuraResponse> {
  const { version, ...config } = leerConfig(body);
  const c = await requerirAdmin(ctx, "config.guardar", "estructura");
  if (config.responsableTecnicoId && !(await ctx.deps.contactos()).users.some((u) => u.id === config.responsableTecnicoId)) throw rechazo("no-miembro");
  await guardando(ctx, c, "config.guardar", "estructura", () => ctx.store.guardarConfig(c.alcance, actor(ctx), config, version), { objetoTipo: "proyecto", objetoId: ctx.projectId });
  return respuestaEstructura(ctx, c);
}

// ---------------------------------------------------------------- bitácora

/** Company administrators see the whole company's chain; the bitácora.ver permission, this project's rows. */
export async function getBitacora(ctx: Ctx, params: URLSearchParams): Promise<{ entradas: EntradaBitacora[]; todaLaEmpresa: boolean }> {
  const filtro = leerFiltroBitacora(params);
  const c = await enEmpresa(ctx, "bitacora.consultar", "bitacora");
  if (!c.adminEmpresa && !tiene(c.permisos, "bitacora", "ver")) {
    return denegar(ctx, c, "bitacora.consultar", "bitacora", c.permisos.length ? "sin-permiso" : "sin-acceso");
  }
  const soloProyecto = !c.adminEmpresa || !!filtro.soloProyecto;
  return { entradas: await ctx.store.listBitacora(c.alcance.empresaId, soloProyecto ? ctx.projectId : null, filtro), todaLaEmpresa: !soloProyecto };
}

/** Recomputes the company's chain and records that it was checked. */
export async function verificarBitacora(ctx: Ctx): Promise<VerificacionBitacora> {
  const c = await enEmpresa(ctx, "bitacora.verificar", "bitacora");
  if (!c.adminEmpresa && !tiene(c.permisos, "bitacora", "ver")) return denegar(ctx, c, "bitacora.verificar", "bitacora", "sin-permiso");
  const v = await ctx.store.verificarBitacora(cadenaDe(c.alcance.empresaId));
  await registrar(ctx, c, { accion: "bitacora.verificar", modulo: "bitacora", resultado: "ok", cambios: { filas: v.filas, integra: v.integra, rotaEn: v.rotaEn } });
  return v;
}

// ---------------------------------------------------------------- technical administrator

async function requerirTecnico(ctx: Ctx, que: string): Promise<void> {
  if (!ctx.esAdminTecnico) await denegar(ctx, null, que, "empresas", "solo-admin-tecnico");
}

/** Every company with its license, projects and administrators. */
export async function getEmpresas(ctx: Ctx): Promise<EmpresasResponse> {
  await requerirTecnico(ctx, "admin.consultar");
  const empresas = await ctx.store.listEmpresas();
  return {
    empresas: await Promise.all(
      empresas.map(async (e) => {
        const [licencias, proyectos, usuarios] = await Promise.all([ctx.store.listLicencias(e.id), ctx.store.listProyectos(e.id), ctx.store.listUsuarios(e.id)]);
        const licencia = licenciaVigente(licencias);
        return {
          ...e,
          licencia,
          estadoLicencia: estadoLicencia(licencia, e.activa, ctx.hoy).estado,
          proyectos,
          administradores: usuarios.filter((u) => u.adminEmpresa),
          usuariosActivos: usuarios.filter((u) => u.activo).length,
        };
      })
    ),
    hoy: ctx.hoy,
  };
}

/** The license history of one company. */
export async function getLicencias(ctx: Ctx, empresaId: string | null): Promise<{ licencias: Licencia[] }> {
  await requerirTecnico(ctx, "admin.consultar");
  if (!empresaId) throw rechazo("datos");
  return { licencias: (await ctx.store.listLicencias(empresaId)).reverse() };
}

/** Creates or changes a company; a new one comes with the initial roles and the template of levels. */
export async function guardarEmpresa(ctx: Ctx, body: unknown): Promise<EmpresasResponse> {
  const cambio = leerCambioEmpresa(body);
  await requerirTecnico(ctx, "empresa.guardar");
  const id = cambio.id ?? globalThis.crypto.randomUUID();
  try {
    await ctx.store.guardarEmpresa(
      actor(ctx),
      { id, nombre: cambio.nombre, nit: cambio.nitLimpio, dv: cambio.dv, activa: cambio.activa, version: cambio.version },
      ROLES_INICIALES,
      NIVELES_INICIALES
    );
  } catch (err) {
    throw traducir(err);
  }
  return getEmpresas(ctx);
}

/** Records a license event (activation, renewal, change, suspension, reactivation): always a new row. */
export async function registrarLicencia(ctx: Ctx, body: unknown): Promise<EmpresasResponse> {
  const l = leerNuevaLicencia(body);
  await requerirTecnico(ctx, "licencias.registrar");
  const problema = revisarLicencia(l);
  if (problema) throw new ServiceError(problema, 400, "datos");
  try {
    await ctx.store.registrarLicencia(actor(ctx), globalThis.crypto.randomUUID(), l);
  } catch (err) {
    throw traducir(err);
  }
  return getEmpresas(ctx);
}

/** Names (or removes) a company administrator by their Trimble Connect e-mail. */
export async function guardarAdminEmpresa(ctx: Ctx, body: unknown): Promise<EmpresasResponse> {
  const a = leerAdminEmpresa(body);
  await requerirTecnico(ctx, "administradores.guardar");
  try {
    await ctx.store.guardarAdminEmpresa(actor(ctx), a.empresaId, a.email, a.nombre, a.admin);
  } catch (err) {
    throw traducir(err);
  }
  return getEmpresas(ctx);
}

/** The bitácora of a company (or the technical administrator's own chain) for the technical administrator. */
export async function getBitacoraAdmin(ctx: Ctx, params: URLSearchParams): Promise<{ entradas: EntradaBitacora[] }> {
  const empresaId = leerEmpresaOpcional(params.get("empresaId"));
  const filtro = leerFiltroBitacora(params);
  await requerirTecnico(ctx, "admin.bitacora");
  return { entradas: await ctx.store.listBitacora(empresaId, null, filtro) };
}

export async function verificarBitacoraAdmin(ctx: Ctx, params: URLSearchParams): Promise<VerificacionBitacora> {
  const empresaId = leerEmpresaOpcional(params.get("empresaId"));
  await requerirTecnico(ctx, "admin.bitacora");
  const v = await ctx.store.verificarBitacora(cadenaDe(empresaId));
  await registrar(ctx, empresaId ? { empresa: { id: empresaId } as Empresa } : null, {
    accion: "bitacora.verificar",
    modulo: "bitacora",
    resultado: "ok",
    projectId: null,
    cambios: { filas: v.filas, integra: v.integra, rotaEn: v.rotaEn },
  });
  return v;
}
