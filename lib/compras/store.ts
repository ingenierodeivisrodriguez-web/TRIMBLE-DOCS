import { StoreError } from "../propiedades/store";
import { hoyIso } from "../manuales/licencia";
import { esMotivo, ESTADO_HTTP, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol, tiene } from "./accesos";
import { numeroRequisicion, puedeEditar, revisarAccion, TRANSICIONES } from "./requisiciones";
import type { RolInicial } from "./roles";
import { clienteSupabase, eq, faltaTabla } from "./supabase";
import {
  AccionSobreRequisicion,
  Asignacion,
  CambioAsignacion,
  CambioRol,
  ConfigCompras,
  EntradaAuditoria,
  FiltroAuditoria,
  LineaRequisicion,
  MAX_AUDITORIA,
  Permiso,
  PERMISOS_VALIDOS,
  Prioridad,
  Requisicion,
  Rol,
  ROL_ADMIN,
} from "./types";

/**
 * Persistence of "Compras y Contratación". Two implementations with the same
 * rules: Supabase (tables and functions of supabase/compras.sql, through its
 * REST API with the server-only key) and memory (for `next dev` without a
 * database and for tests). Refusals come as a StoreError whose message is
 * the reason's code (see accesos.ts); routes.ts turns it into the message.
 */
export interface Actor {
  id: string;
  nombre: string;
}

export interface Persona {
  nombre: string;
  email: string;
}

export type NuevaEntrada = Omit<EntradaAuditoria, "id" | "creado">;

export interface ComprasStore {
  listRoles(projectId: string): Promise<Rol[]>;
  listUsuarios(projectId: string): Promise<Asignacion[]>;
  /** Creates the initial roles (those missing) and makes `admin` the Administrador de plataforma; refused ("ya-activo") if there is one. */
  activar(projectId: string, admin: Actor & { email: string }, roles: RolInicial[]): Promise<void>;
  /** Gives, changes or revokes an access; returns its new version. */
  guardarUsuario(projectId: string, actor: Actor, persona: Persona, cambio: CambioAsignacion): Promise<number>;
  /** Creates (version 0) or changes a role; returns its new version. */
  guardarRol(projectId: string, actor: Actor, cambio: CambioRol & { id: string }): Promise<number>;
  /** Adds a row to the audit (it can't be changed or removed afterwards). */
  auditar(projectId: string, entrada: NuevaEntrada): Promise<void>;
  /** Newest first. */
  listAuditoria(projectId: string, filtro: FiltroAuditoria): Promise<EntradaAuditoria[]>;

  /** The project's settings (tolerance 0 and version 0 until first saved). */
  getConfig(projectId: string): Promise<ConfigCompras>;
  guardarConfig(projectId: string, actor: Actor, toleranciaPct: number, version: number): Promise<number>;

  /** Every requisition of the project with its lines, newest first. */
  listRequisiciones(projectId: string): Promise<Requisicion[]>;
  /** Creates (version 0) or changes a draft, replacing its lines; returns its new version. */
  guardarRequisicion(projectId: string, actor: Actor, id: string, datos: DatosRequisicion, lineas: LineaGuardada[], version: number): Promise<number>;
  /** Sends, approves, rejects, returns or cancels; `limites` are the current budget's, by resource. */
  cambiarEstadoRequisicion(
    projectId: string,
    actor: Actor,
    id: string,
    accion: AccionSobreRequisicion,
    limites: Record<string, { planificado: number; limite: number }>,
    presupuestoVersion: number | null
  ): Promise<number>;
}

export interface DatosRequisicion {
  fechaRequerida: string;
  prioridad: Prioridad;
  justificacion: string;
}

/** A line as saved: the resource's data comes from the budget. */
export type LineaGuardada = Omit<LineaRequisicion, "cantidadAprobada" | "planificado">;

function rechazo(motivo: MotivoRechazo): StoreError {
  return new StoreError(motivo, ESTADO_HTTP[motivo]);
}

/** "2026-10-16" -> "2026-10-17". */
function diaSiguiente(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Colombia has no daylight saving time: its days start at 05:00 UTC. */
const inicioDia = (iso: string) => `${iso}T00:00:00-05:00`;

// ---------------------------------------------------------------- Supabase

const SETUP_HINT =
  "Faltan las tablas de Compras en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/compras.sql del repositorio.";

interface RolRow {
  id: string;
  clave: string;
  nombre: string;
  descripcion: string;
  sistema: boolean;
  activo: boolean;
  permisos: string[] | null;
  version: number;
  actualizado: string | null;
  actualizado_por: string | null;
}

interface UsuarioRow {
  user_id: string;
  nombre: string;
  email: string;
  rol_id: string;
  desde: string;
  hasta: string | null;
  activo: boolean;
  version: number;
  otorgado_por: string;
  actualizado: string | null;
  actualizado_por: string | null;
}

interface AuditoriaRow {
  id: number;
  creado: string;
  actor_id: string;
  actor_nombre: string;
  accion: string;
  modulo: string;
  objeto_tipo: string;
  objeto_id: string;
  sujeto_id: string | null;
  sujeto_nombre: string;
  resultado: EntradaAuditoria["resultado"];
  detalle: Record<string, unknown> | null;
}

function rolDeFila(r: RolRow): Rol {
  const set = new Set(r.permisos ?? []);
  return {
    id: r.id,
    clave: r.clave,
    nombre: r.nombre,
    descripcion: r.descripcion,
    sistema: r.sistema,
    activo: r.activo,
    permisos: PERMISOS_VALIDOS.filter((p) => set.has(p)),
    version: r.version,
    actualizado: r.actualizado,
    actualizadoPor: r.actualizado_por,
  };
}

function usuarioDeFila(r: UsuarioRow): Asignacion {
  return {
    userId: r.user_id,
    nombre: r.nombre,
    email: r.email,
    rolId: r.rol_id,
    desde: r.desde,
    hasta: r.hasta,
    activo: r.activo,
    version: r.version,
    otorgadoPor: r.otorgado_por,
    actualizado: r.actualizado,
    actualizadoPor: r.actualizado_por,
  };
}

function entradaDeFila(r: AuditoriaRow): EntradaAuditoria {
  return {
    id: Number(r.id),
    creado: r.creado,
    actorId: r.actor_id,
    actorNombre: r.actor_nombre,
    accion: r.accion,
    modulo: r.modulo,
    objetoTipo: r.objeto_tipo,
    objetoId: r.objeto_id,
    sujetoId: r.sujeto_id,
    sujetoNombre: r.sujeto_nombre,
    resultado: r.resultado,
    detalle: r.detalle ?? {},
  };
}

function supabaseStore(): ComprasStore | null {
  const db = clienteSupabase((_status, body, detail) => {
    // The SQL functions refuse with "compras:<reason>".
    const motivo = /compras:([a-z-]+)/.exec(detail.message ?? body)?.[1];
    if (motivo && esMotivo(motivo)) return rechazo(motivo);
    if (/version-conflict/.test(body)) return rechazo("version-conflict");
    if (detail.code === "23505") return rechazo(/compras_req_lineas_unica/.test(body) ? "linea-duplicada" : "nombre-repetido");
    if (faltaTabla(body)) return new StoreError(SETUP_HINT);
    if (detail.code && /^(22\w{3}|23\w{3})$/.test(detail.code)) return rechazo("datos");
    return null;
  });
  if (!db) return null;
  const { call, json, all } = db;
  const rpc = <T>(fn: string, body: unknown) => json<T>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

  return {
    async listRoles(projectId) {
      const rows = await all<RolRow>(
        `/compras_roles?project_id=${eq(projectId)}&select=id,clave,nombre,descripcion,sistema,activo,permisos,version,actualizado,actualizado_por&order=sistema.desc,nombre.asc`
      );
      return rows.map(rolDeFila);
    },

    async listUsuarios(projectId) {
      const rows = await all<UsuarioRow>(
        `/compras_usuarios?project_id=${eq(projectId)}&select=user_id,nombre,email,rol_id,desde,hasta,activo,version,otorgado_por,actualizado,actualizado_por&order=nombre.asc`
      );
      return rows.map(usuarioDeFila);
    },

    async activar(projectId, admin, roles) {
      await call("/rpc/compras_activar", {
        method: "POST",
        body: JSON.stringify({ p_project_id: projectId, p_user_id: admin.id, p_nombre: admin.nombre, p_email: admin.email, p_roles: roles }),
      });
    },

    guardarUsuario: (projectId, actor, persona, c) =>
      rpc<number>("compras_guardar_usuario", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_user_id: c.userId,
        p_nombre: persona.nombre,
        p_email: persona.email,
        p_rol_id: c.rolId,
        p_desde: c.desde,
        p_hasta: c.hasta,
        p_activo: c.activo,
        p_version: c.version,
      }),

    guardarRol: (projectId, actor, c) =>
      rpc<number>("compras_guardar_rol", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: c.id,
        p_nombre: c.nombre,
        p_descripcion: c.descripcion,
        p_permisos: c.permisos,
        p_activo: c.activo,
        p_version: c.version,
      }),

    async auditar(projectId, e) {
      await call("/compras_auditoria", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          project_id: projectId,
          actor_id: e.actorId,
          actor_nombre: e.actorNombre,
          accion: e.accion,
          modulo: e.modulo,
          objeto_tipo: e.objetoTipo,
          objeto_id: e.objetoId,
          sujeto_id: e.sujetoId,
          sujeto_nombre: e.sujetoNombre,
          resultado: e.resultado,
          detalle: e.detalle,
        }),
      });
    },

    async listAuditoria(projectId, f) {
      const q = [`project_id=${eq(projectId)}`];
      if (f.desde) q.push(`creado=gte.${encodeURIComponent(inicioDia(f.desde))}`);
      if (f.hasta) q.push(`creado=lt.${encodeURIComponent(inicioDia(diaSiguiente(f.hasta)))}`);
      if (f.actorId) q.push(`actor_id=${eq(f.actorId)}`);
      if (f.modulo) q.push(`modulo=${eq(f.modulo)}`);
      if (f.resultado) q.push(`resultado=${eq(f.resultado)}`);
      if (f.antesDe) q.push(`id=lt.${f.antesDe}`);
      const limite = Math.min(f.limite ?? MAX_AUDITORIA, MAX_AUDITORIA);
      const rows = await json<AuditoriaRow[]>(
        `/compras_auditoria?${q.join("&")}&select=id,creado,actor_id,actor_nombre,accion,modulo,objeto_tipo,objeto_id,sujeto_id,sujeto_nombre,resultado,detalle&order=id.desc&limit=${limite}`
      );
      return rows.map(entradaDeFila);
    },

    async getConfig(projectId) {
      const rows = await json<{ tolerancia_pct: number | string; version: number }[]>(`/compras_config?project_id=${eq(projectId)}&select=tolerancia_pct,version`);
      return rows[0] ? { toleranciaPct: Number(rows[0].tolerancia_pct), version: rows[0].version } : { toleranciaPct: 0, version: 0 };
    },

    guardarConfig: (projectId, actor, toleranciaPct, version) =>
      rpc<number>("compras_guardar_config", { p_project_id: projectId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_tolerancia: toleranciaPct, p_version: version }),

    async listRequisiciones(projectId) {
      const [reqs, lineas] = await Promise.all([
        all<RequisicionRow>(
          `/compras_requisiciones?project_id=${eq(projectId)}&select=id,numero,estado,solicitante_id,solicitante_nombre,fecha_requerida,prioridad,justificacion,motivo,presupuesto_version,enviada,enviada_por,decidida,decidida_por,version,creada,actualizado,actualizado_por&order=numero.desc`
        ),
        all<LineaRow>(
          `/compras_requisicion_lineas?project_id=${eq(projectId)}&select=id,requisicion_id,orden,insumo_id,partida_item_id,codigo,descripcion,unidad,tipo,precio,cantidad,cantidad_aprobada,planificado,justificacion_exceso&order=requisicion_id.asc,orden.asc`
        ),
      ]);
      const porReq = new Map<string, LineaRequisicion[]>();
      for (const l of lineas) porReq.set(l.requisicion_id, [...(porReq.get(l.requisicion_id) ?? []), lineaDeFila(l)]);
      return reqs.map((r) => requisicionDeFila(r, porReq.get(r.id) ?? []));
    },

    guardarRequisicion: (projectId, actor, id, d, lineas, version) =>
      rpc<number>("compras_guardar_requisicion", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_fecha_requerida: d.fechaRequerida,
        p_prioridad: d.prioridad,
        p_justificacion: d.justificacion,
        p_lineas: lineas.map((l, orden) => ({
          id: l.id,
          orden,
          insumo_id: l.insumoId,
          partida_item_id: l.partidaItemId,
          codigo: l.codigo,
          descripcion: l.descripcion,
          unidad: l.unidad,
          tipo: l.tipo,
          precio: l.precio,
          cantidad: l.cantidad,
          justificacion_exceso: l.justificacionExceso,
        })),
        p_version: version,
      }),

    cambiarEstadoRequisicion: (projectId, actor, id, a, limites, presupuestoVersion) =>
      rpc<number>("compras_cambiar_estado_requisicion", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_accion: a.accion,
        p_motivo: a.motivo,
        p_aprobadas: a.aprobadas ?? null,
        p_limites: limites,
        p_presupuesto_version: presupuestoVersion,
        p_version: a.version,
      }),
  };
}

interface RequisicionRow {
  id: string;
  numero: number;
  estado: Requisicion["estado"];
  solicitante_id: string;
  solicitante_nombre: string;
  fecha_requerida: string;
  prioridad: Prioridad;
  justificacion: string;
  motivo: string;
  presupuesto_version: number | null;
  enviada: string | null;
  enviada_por: string | null;
  decidida: string | null;
  decidida_por: string | null;
  version: number;
  creada: string;
  actualizado: string | null;
  actualizado_por: string | null;
}

interface LineaRow {
  id: string;
  requisicion_id: string;
  orden: number;
  insumo_id: string;
  partida_item_id: string | null;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: LineaRequisicion["tipo"];
  precio: number | string;
  cantidad: number | string;
  cantidad_aprobada: number | string | null;
  planificado: number | string | null;
  justificacion_exceso: string;
}

const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

function lineaDeFila(l: LineaRow): LineaRequisicion {
  return {
    id: l.id,
    insumoId: l.insumo_id,
    partidaItemId: l.partida_item_id,
    codigo: l.codigo,
    descripcion: l.descripcion,
    unidad: l.unidad,
    tipo: l.tipo,
    precio: Number(l.precio),
    cantidad: Number(l.cantidad),
    cantidadAprobada: numOrNull(l.cantidad_aprobada),
    planificado: numOrNull(l.planificado),
    justificacionExceso: l.justificacion_exceso,
  };
}

function requisicionDeFila(r: RequisicionRow, lineas: LineaRequisicion[]): Requisicion {
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    solicitanteId: r.solicitante_id,
    solicitanteNombre: r.solicitante_nombre,
    fechaRequerida: r.fecha_requerida,
    prioridad: r.prioridad,
    justificacion: r.justificacion,
    motivo: r.motivo,
    presupuestoVersion: r.presupuesto_version,
    enviada: r.enviada,
    enviadaPor: r.enviada_por,
    decidida: r.decidida,
    decididaPor: r.decidida_por,
    lineas,
    version: r.version,
    creada: r.creada,
    actualizado: r.actualizado,
    actualizadoPor: r.actualizado_por,
  };
}

// ---------------------------------------------------------------- memory

/** Same rules as the SQL functions, without a database. */
export function memoryStore(hoy: () => string = () => hoyIso()): ComprasStore {
  const roles = new Map<string, Rol & { projectId: string }>();
  const usuarios = new Map<string, Asignacion & { projectId: string }>();
  const auditoria: (EntradaAuditoria & { projectId: string })[] = [];
  const configs = new Map<string, ConfigCompras>();
  const requisiciones = new Map<string, Requisicion & { projectId: string }>();
  const consecutivos = new Map<string, number>();
  const reqsDe = (projectId: string): Requisicion[] =>
    [...requisiciones.values()].filter((r) => r.projectId === projectId).map(({ projectId: _, ...r }) => structuredClone(r));
  const permisosDe = (projectId: string, userId: string) => permisosVigentes(userId, usuariosDe(projectId), rolesDe(projectId), hoy());
  const ahora = () => new Date().toISOString();

  const rolesDe = (projectId: string): Rol[] => [...roles.values()].filter((r) => r.projectId === projectId).map(({ projectId: _, ...r }) => ({ ...r }));
  const usuariosDe = (projectId: string): Asignacion[] => [...usuarios.values()].filter((u) => u.projectId === projectId).map(({ projectId: _, ...u }) => ({ ...u }));
  function auditar(projectId: string, e: NuevaEntrada) {
    auditoria.push({ ...structuredClone(e), id: auditoria.length + 1, creado: ahora(), projectId });
  }

  return {
    async listRoles(projectId) {
      return rolesDe(projectId).sort((a, b) => Number(b.sistema) - Number(a.sistema) || a.nombre.localeCompare(b.nombre, "es"));
    },
    async listUsuarios(projectId) {
      return usuariosDe(projectId).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    },
    async activar(projectId, admin, iniciales) {
      const hayAdmin = usuariosDe(projectId).some((u) => {
        const r = roles.get(u.rolId);
        return r?.clave === ROL_ADMIN && u.activo && (u.hasta === null || u.hasta >= hoy());
      });
      if (hayAdmin) throw rechazo("ya-activo");
      for (const ini of iniciales) {
        if (rolesDe(projectId).some((r) => r.clave === ini.clave)) continue;
        const id = globalThis.crypto.randomUUID();
        roles.set(id, { id, projectId, clave: ini.clave, nombre: ini.nombre, descripcion: ini.descripcion, sistema: true, activo: true, permisos: [...ini.permisos], version: 1, actualizado: ahora(), actualizadoPor: admin.nombre });
      }
      const rolAdmin = [...roles.values()].find((r) => r.projectId === projectId && r.clave === ROL_ADMIN);
      if (!rolAdmin) throw rechazo("rol-no-valido");
      Object.assign(rolAdmin, { permisos: [...PERMISOS_VALIDOS], activo: true });
      const antes = usuarios.get(`${projectId}|${admin.id}`);
      usuarios.set(`${projectId}|${admin.id}`, {
        projectId, userId: admin.id, nombre: admin.nombre, email: admin.email, rolId: rolAdmin.id, desde: hoy(), hasta: null, activo: true,
        version: (antes?.version ?? 0) + 1, otorgadoPor: antes?.otorgadoPor ?? admin.nombre, actualizado: ahora(), actualizadoPor: admin.nombre,
      });
      auditar(projectId, { actorId: admin.id, actorNombre: admin.nombre, accion: "proyecto.activar", modulo: "accesos", objetoTipo: "proyecto", objetoId: projectId, sujetoId: admin.id, sujetoNombre: admin.nombre, resultado: "ok", detalle: { rol: rolAdmin.nombre } });
    },
    async guardarUsuario(projectId, actor, persona, c) {
      const rs = rolesDe(projectId);
      const us = usuariosDe(projectId);
      const motivo = revisarAsignacion({ actorId: actor.id, misPermisos: permisosVigentes(actor.id, us, rs, hoy()), roles: rs, usuarios: us, hoy: hoy() }, c);
      if (motivo) throw rechazo(motivo);
      const k = `${projectId}|${c.userId}`;
      const antes = usuarios.get(k);
      const version = c.version + 1;
      usuarios.set(k, {
        projectId, userId: c.userId, nombre: persona.nombre, email: persona.email, rolId: c.rolId, desde: c.desde, hasta: c.hasta, activo: c.activo,
        version, otorgadoPor: antes?.otorgadoPor ?? actor.nombre, actualizado: ahora(), actualizadoPor: actor.nombre,
      });
      const nombreRol = (id: string | undefined) => rs.find((r) => r.id === id)?.nombre ?? "";
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre,
        accion: !antes ? "accesos.asignar" : !c.activo ? "accesos.revocar" : "accesos.cambiar",
        modulo: "accesos", objetoTipo: "usuario", objetoId: c.userId, sujetoId: c.userId, sujetoNombre: persona.nombre, resultado: "ok",
        detalle: {
          antes: antes ? { rol: nombreRol(antes.rolId), desde: antes.desde, hasta: antes.hasta, activo: antes.activo } : null,
          despues: { rol: nombreRol(c.rolId), desde: c.desde, hasta: c.hasta, activo: c.activo },
        },
      });
      return version;
    },
    async guardarRol(projectId, actor, c) {
      const rs = rolesDe(projectId);
      const us = usuariosDe(projectId);
      const existe = rs.find((r) => r.id === c.id);
      const motivo = revisarRol({ actorId: actor.id, misPermisos: permisosVigentes(actor.id, us, rs, hoy()), roles: rs, usuarios: us, hoy: hoy() }, { ...c, id: existe ? c.id : undefined });
      if (motivo) throw rechazo(motivo);
      const nombre = c.nombre.trim();
      if (rs.some((r) => r.id !== c.id && r.nombre.trim().toLowerCase() === nombre.toLowerCase())) throw rechazo("nombre-repetido");
      const version = c.version + 1;
      roles.set(c.id, {
        projectId, id: c.id, clave: existe?.clave ?? `personal_${c.id.replace(/-/g, "").slice(0, 12)}`, nombre, descripcion: c.descripcion,
        sistema: existe?.sistema ?? false, activo: c.activo, permisos: [...c.permisos] as Permiso[], version, actualizado: ahora(), actualizadoPor: actor.nombre,
      });
      const antes = new Set<string>(existe?.permisos ?? []);
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: existe ? "roles.cambiar" : "roles.crear", modulo: "accesos", objetoTipo: "rol", objetoId: c.id,
        sujetoId: null, sujetoNombre: nombre, resultado: "ok",
        detalle: { agregados: c.permisos.filter((p) => !antes.has(p)), quitados: [...antes].filter((p) => !c.permisos.includes(p as Permiso)), activo: c.activo },
      });
      return version;
    },
    async auditar(projectId, e) {
      auditar(projectId, e);
    },
    async listAuditoria(projectId, f) {
      const desde = f.desde ? Date.parse(inicioDia(f.desde)) : -Infinity;
      const hasta = f.hasta ? Date.parse(inicioDia(diaSiguiente(f.hasta))) : Infinity;
      return auditoria
        .filter(
          (e) =>
            e.projectId === projectId &&
            Date.parse(e.creado) >= desde &&
            Date.parse(e.creado) < hasta &&
            (!f.actorId || e.actorId === f.actorId) &&
            (!f.modulo || e.modulo === f.modulo) &&
            (!f.resultado || e.resultado === f.resultado) &&
            (!f.antesDe || e.id < f.antesDe)
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, Math.min(f.limite ?? MAX_AUDITORIA, MAX_AUDITORIA))
        .map(({ projectId: _, ...e }) => structuredClone(e));
    },
    async getConfig(projectId) {
      return { ...(configs.get(projectId) ?? { toleranciaPct: 0, version: 0 }) };
    },
    async guardarConfig(projectId, actor, toleranciaPct, version) {
      if (!tiene(permisosDe(projectId, actor.id), "accesos", "administrar")) throw rechazo("sin-permiso");
      const antes = configs.get(projectId);
      if ((antes?.version ?? 0) !== version) throw rechazo("version-conflict");
      if (!(toleranciaPct >= 0 && toleranciaPct <= 100)) throw rechazo("datos");
      configs.set(projectId, { toleranciaPct, version: version + 1 });
      auditar(projectId, { actorId: actor.id, actorNombre: actor.nombre, accion: "config.cambiar", modulo: "requisiciones", objetoTipo: "proyecto", objetoId: projectId, sujetoId: null, sujetoNombre: "", resultado: "ok", detalle: { tolerancia_antes: antes?.toleranciaPct ?? 0, tolerancia: toleranciaPct } });
      return version + 1;
    },
    async listRequisiciones(projectId) {
      return reqsDe(projectId).sort((a, b) => b.numero - a.numero);
    },
    async guardarRequisicion(projectId, actor, id, d, lineas, version) {
      const mios = permisosDe(projectId, actor.id);
      const antes = requisiciones.get(id);
      if (antes && antes.projectId !== projectId) throw rechazo("no-existe");
      if (!antes) {
        if (!tiene(mios, "requisiciones", "crear")) throw rechazo("sin-permiso");
        if (version !== 0) throw rechazo("version-conflict");
      } else {
        if (antes.estado !== "borrador") throw rechazo("estado-no-valido");
        if (!puedeEditar(antes, actor.id, mios)) throw rechazo("sin-permiso");
        if (antes.version !== version) throw rechazo("version-conflict");
      }
      const claves = new Set(lineas.map((l) => `${l.insumoId}|${l.partidaItemId ?? ""}`));
      if (claves.size !== lineas.length) throw rechazo("linea-duplicada");
      if (lineas.some((l) => !(l.cantidad > 0))) throw rechazo("datos");
      let numero = antes?.numero;
      if (!numero) {
        numero = (consecutivos.get(projectId) ?? 0) + 1;
        consecutivos.set(projectId, numero);
      }
      const ahoraIso = ahora();
      requisiciones.set(id, {
        projectId,
        id,
        numero,
        estado: "borrador",
        solicitanteId: antes?.solicitanteId ?? actor.id,
        solicitanteNombre: antes?.solicitanteNombre ?? actor.nombre,
        fechaRequerida: d.fechaRequerida,
        prioridad: d.prioridad,
        justificacion: d.justificacion,
        motivo: antes?.motivo ?? "",
        presupuestoVersion: antes?.presupuestoVersion ?? null,
        enviada: antes?.enviada ?? null,
        enviadaPor: antes?.enviadaPor ?? null,
        decidida: antes?.decidida ?? null,
        decididaPor: antes?.decididaPor ?? null,
        lineas: lineas.map((l) => ({ ...l, cantidadAprobada: null, planificado: null })),
        version: version + 1,
        creada: antes?.creada ?? ahoraIso,
        actualizado: ahoraIso,
        actualizadoPor: actor.nombre,
      });
      auditar(projectId, { actorId: actor.id, actorNombre: actor.nombre, accion: antes ? "requisiciones.editar" : "requisiciones.crear", modulo: "requisiciones", objetoTipo: "requisicion", objetoId: id, sujetoId: null, sujetoNombre: numeroRequisicion(numero), resultado: "ok", detalle: { lineas: lineas.length, fecha_requerida: d.fechaRequerida, prioridad: d.prioridad } });
      return version + 1;
    },
    async cambiarEstadoRequisicion(projectId, actor, id, a, limites, presupuestoVersion) {
      const r = requisiciones.get(id);
      if (!r || r.projectId !== projectId) throw rechazo("no-existe");
      // The limits already include the tolerance.
      const planificados = new Map(Object.entries(limites).map(([k, v]) => [k, v.limite]));
      const motivo = revisarAccion({ actorId: actor.id, permisos: permisosDe(projectId, actor.id), hoy: hoy(), toleranciaPct: 0, planificados, requisiciones: reqsDe(projectId) }, r, a);
      if (motivo) throw rechazo(motivo);
      const de = r.estado;
      const ahoraIso = ahora();
      if (a.accion === "enviar") {
        r.lineas = r.lineas.map((l) => ({ ...l, planificado: limites[l.insumoId]?.planificado ?? 0, cantidadAprobada: null }));
        Object.assign(r, { enviada: ahoraIso, enviadaPor: actor.nombre, presupuestoVersion, motivo: "" });
      } else {
        if (a.accion === "aprobar") r.lineas = r.lineas.map((l) => ({ ...l, cantidadAprobada: Math.round((a.aprobadas?.[l.id] ?? l.cantidad) * 10_000) / 10_000 }));
        Object.assign(r, { decidida: ahoraIso, decididaPor: actor.nombre, motivo: a.motivo.trim() });
      }
      r.estado = TRANSICIONES[a.accion].hacia;
      r.version += 1;
      r.actualizado = ahoraIso;
      r.actualizadoPor = actor.nombre;
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: `requisiciones.${a.accion}`, modulo: "requisiciones", objetoTipo: "requisicion", objetoId: id,
        sujetoId: r.solicitanteId, sujetoNombre: numeroRequisicion(r.numero), resultado: "ok",
        detalle: { de, a: r.estado, motivo: a.motivo.trim(), aprobadas: a.accion === "aprobar" ? Object.fromEntries(r.lineas.map((l) => [l.descripcion, l.cantidadAprobada])) : {} },
      });
      return r.version;
    },
  };
}

let selected: ComprasStore | null | undefined;
let devStore: ComprasStore | undefined;

/** Supabase when configured; in development without it, data kept in memory. */
export function comprasStore(): ComprasStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError(
      "La base de datos de Compras no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/compras.sql y vuelve a desplegar."
    );
  }
  return (devStore ??= memoryStore());
}
