import { StoreError } from "../propiedades/store";
import { hoyIso } from "../manuales/licencia";
import { esMotivo, ESTADO_HTTP, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol } from "./accesos";
import type { RolInicial } from "./roles";
import { Asignacion, CambioAsignacion, CambioRol, EntradaAuditoria, FiltroAuditoria, MAX_AUDITORIA, Permiso, PERMISOS_VALIDOS, Rol, ROL_ADMIN } from "./types";

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
}

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

const REQUEST_TIMEOUT_MS = 20_000;
const LENTA = "La base de datos (Supabase) tardó demasiado en responder. Intenta de nuevo en un momento.";
const esTiempo = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
const PAGE = 1000;

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
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;

  const rest = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs; the newer "sb_secret_…" keys only go as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${rest}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      if (esTiempo(err) && init.method && init.method !== "GET") throw new StoreError(LENTA, 504);
      throw err;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    let detail: { code?: string; message?: string } = {};
    try {
      detail = JSON.parse(body);
    } catch {
      // not JSON
    }
    // The SQL functions refuse with "compras:<reason>".
    const motivo = /compras:([a-z-]+)/.exec(detail.message ?? body)?.[1];
    if (motivo && esMotivo(motivo)) throw rechazo(motivo);
    if (/version-conflict/.test(body)) throw rechazo("version-conflict");
    if (detail.code === "23505") throw rechazo("nombre-repetido");
    if (/PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body)) throw new StoreError(SETUP_HINT);
    if (res.status === 401 || res.status === 403) {
      throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    if (detail.code && /^(22\w{3}|23\w{3})$/.test(detail.code)) throw rechazo("datos");
    throw new StoreError(`Supabase respondió ${res.status}${detail.message ? `: ${detail.message}` : ""}`);
  }

  /** The answer as JSON. A read that runs out of time is tried once more. */
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const lectura = !init?.method || init.method === "GET";
    for (let intento = 0; ; intento++) {
      try {
        return (await (await call(path, init)).json()) as T;
      } catch (err) {
        if (!esTiempo(err)) throw err;
        if (lectura && intento === 0) continue;
        throw new StoreError(LENTA, 504);
      }
    }
  }

  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await json<T[]>(`${path}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;
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
  };
}

// ---------------------------------------------------------------- memory

/** Same rules as the SQL functions, without a database. */
export function memoryStore(hoy: () => string = () => hoyIso()): ComprasStore {
  const roles = new Map<string, Rol & { projectId: string }>();
  const usuarios = new Map<string, Asignacion & { projectId: string }>();
  const auditoria: (EntradaAuditoria & { projectId: string })[] = [];
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
