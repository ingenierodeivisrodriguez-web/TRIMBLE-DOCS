import { StoreError } from "../propiedades/store";
import { hoyIso } from "../manuales/licencia";
import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { asignacionVigente, esMotivo, ESTADO_HTTP, estadoAsignacion, MotivoRechazo, superaCupoUsuarios, usuarioDe } from "./accesos";
import { cadenaDe, HASH_INICIAL, hashDe, verificarCadena } from "./bitacora";
import { permisoDePaso } from "./flujos";
import { licenciaPermiteTrabajar, licenciaVigente, estadoLicencia, modulosHabilitados, permisosContratados } from "./licencias";
import { ordenar, RolInicial } from "./roles";
import {
  Asignacion,
  CambioAsignacion,
  CambioEmpresa,
  CambioFlujo,
  CambioNivel,
  CambioNodo,
  CambioRol,
  CONFIG_INICIAL,
  ConfigProyecto,
  Empresa,
  EntradaBitacora,
  FiltroBitacora,
  Flujo,
  GrupoLicencia,
  Licencia,
  MAX_BITACORA,
  Nivel,
  Nodo,
  NuevaEntrada,
  NuevaLicencia,
  Permiso,
  ProyectoEmpresa,
  Rol,
  TIPOS_FLUJO,
  TipoFlujo,
  UsuarioEmpresa,
  VerificacionBitacora,
} from "./types";

/**
 * Persistence of "Control de Obra". Two implementations with the same rules:
 * Supabase (tables and functions of supabase/control-obra.sql, through its REST
 * API with the server-only key) and memory (for `next dev` without a database
 * and for tests). Refusals come as a StoreError whose message is the reason's
 * code (see accesos.ts).
 *
 * Isolation (doc §11): every read of a project's data takes an `Alcance`
 * (company + project) and filters by both; the company's data takes its id.
 * The service builds the scope only after checking who calls (routes.ts →
 * service.ts `cargar`); the browser never sends the company.
 */
export interface Alcance {
  readonly empresaId: string;
  readonly projectId: string;
}

export interface Actor {
  id: string;
  nombre: string;
}

export interface PersonaAsignada {
  nombre: string;
  email: string;
}

/** A company as saved: the NIT already split into digits and check digit. */
export type EmpresaGuardada = Omit<CambioEmpresa, "nit" | "id"> & { id: string; nit: string; dv: number | null };

export type NivelInicial = Omit<CambioNivel, "projectId" | "version">;

export interface ObraStore {
  /** The company a project is registered to now (null: none). */
  proyectoActivo(projectId: string): Promise<ProyectoEmpresa | null>;
  /** The companies where this Trimble user is a person, with that person. */
  membresias(userId: string): Promise<{ empresa: Empresa; usuario: UsuarioEmpresa }[]>;
  /** Ties the invitations by e-mail to the Trimble user; returns how many. */
  vincularUsuario(email: string, userId: string, nombre: string): Promise<number>;

  getEmpresa(empresaId: string): Promise<Empresa | null>;
  /** The company's license history, oldest first. */
  listLicencias(empresaId: string): Promise<Licencia[]>;
  listRoles(empresaId: string): Promise<Rol[]>;
  listUsuarios(empresaId: string): Promise<UsuarioEmpresa[]>;
  listProyectos(empresaId: string): Promise<ProyectoEmpresa[]>;
  /** A person's accesses in every project of the company. */
  asignacionesDe(empresaId: string, userId: string): Promise<Asignacion[]>;
  /** The company's template of levels. */
  listPlantilla(empresaId: string): Promise<Nivel[]>;

  listAsignaciones(a: Alcance): Promise<Asignacion[]>;
  getConfig(a: Alcance): Promise<ConfigProyecto>;
  /** The project's own levels (not the template's). */
  listNivelesProyecto(a: Alcance): Promise<Nivel[]>;
  listNodos(a: Alcance): Promise<Nodo[]>;

  vincularProyecto(empresaId: string, projectId: string, projectName: string, actor: Actor): Promise<void>;
  desvincularProyecto(a: Alcance, actor: Actor, motivo: string): Promise<void>;
  /** Creates (version 0) or changes a role; returns its new version. */
  guardarRol(empresaId: string, actor: Actor, cambio: CambioRol & { id: string }): Promise<number>;
  /** (De)activates a person in the whole company. */
  guardarUsuario(empresaId: string, actor: Actor, id: string, activo: boolean, version: number): Promise<number>;
  guardarAsignacion(a: Alcance, actor: Actor, persona: PersonaAsignada, cambio: CambioAsignacion): Promise<number>;
  guardarConfig(a: Alcance, actor: Actor, config: Omit<ConfigProyecto, "version">, version: number): Promise<number>;
  /** projectId null: the company's template. */
  guardarNivel(empresaId: string, projectId: string | null, actor: Actor, cambio: CambioNivel & { id: string }): Promise<number>;
  guardarNodo(a: Alcance, actor: Actor, cambio: CambioNodo & { id: string }): Promise<number>;

  /** The approval flows configured in the project (only the kinds that have one). */
  listFlujos(a: Alcance): Promise<Flujo[]>;
  /** Creates (version 0) or changes the flow of a kind of document; returns its new version. */
  guardarFlujo(a: Alcance, actor: Actor, cambio: CambioFlujo): Promise<number>;

  /** Adds a row to the bitácora (its position and hashes are set by the database). */
  registrar(e: NuevaEntrada): Promise<void>;
  /** Newest first. empresaId null: the technical administrator's chain. projectId: only that project's rows. */
  listBitacora(empresaId: string | null, projectId: string | null, f: FiltroBitacora): Promise<EntradaBitacora[]>;
  verificarBitacora(cadena: string): Promise<VerificacionBitacora>;

  listEmpresas(): Promise<Empresa[]>;
  guardarEmpresa(actor: Actor, e: EmpresaGuardada, roles: RolInicial[], niveles: NivelInicial[]): Promise<number>;
  registrarLicencia(actor: Actor, id: string, l: NuevaLicencia): Promise<void>;
  guardarAdminEmpresa(actor: Actor, empresaId: string, email: string, nombre: string, admin: boolean): Promise<void>;
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

const SETUP_HINT =
  "Faltan las tablas de Control de Obra en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/control-obra.sql del repositorio.";

interface EmpresaRow {
  id: string;
  nombre: string;
  nit: string;
  dv: number | null;
  activa: boolean;
  version: number;
  creado: string;
  creado_por: string;
}
interface LicenciaRow {
  id: string;
  empresa_id: string;
  evento: Licencia["evento"];
  plan: string;
  desde: string;
  hasta: string | null;
  max_proyectos: number;
  max_usuarios: number;
  grupos: string[] | null;
  suspendida: boolean;
  motivo: string;
  soporte: string;
  otorgada_por: string;
  creado: string;
}
interface ProyectoRow {
  empresa_id: string;
  project_id: string;
  project_name: string;
  activo: boolean;
  vinculado_por: string;
  vinculado: string;
  motivo: string;
}
interface RolRow {
  id: string;
  clave: string;
  nombre: string;
  descripcion: string;
  sistema: boolean;
  activo: boolean;
  permisos: string[] | null;
  version: number;
}
interface UsuarioRow {
  id: string;
  user_id: string | null;
  email: string;
  nombre: string;
  admin_empresa: boolean;
  activo: boolean;
  version: number;
  otorgado_por: string;
}
interface AsignacionRow {
  project_id: string;
  user_id: string;
  nombre: string;
  email: string;
  rol_id: string;
  admin_proyecto: boolean;
  desde: string;
  hasta: string | null;
  activo: boolean;
  version: number;
  otorgado_por: string;
}
interface NivelRow {
  id: string;
  project_id: string | null;
  clave: string;
  nombre: string;
  orden: number;
  padre_clave: string | null;
  fuente: Nivel["fuente"];
  clave_fuente: string;
  activo: boolean;
  version: number;
}
interface NodoRow {
  id: string;
  nivel_clave: string;
  valor: string;
  padre_id: string | null;
  responsable_id: string | null;
  responsable_nombre: string;
  inicio: string | null;
  fin: string | null;
  estado: Nodo["estado"];
  nota: string;
  version: number;
}
interface FlujoRow {
  tipo: TipoFlujo;
  pasos: { nombre: string; rolId: string }[];
  version: number;
  actualizado: string | null;
  actualizado_por: string | null;
}
interface BitacoraRow {
  n: number | string;
  cadena: string;
  creado: string;
  empresa_id: string | null;
  project_id: string | null;
  actor_id: string;
  actor_nombre: string;
  accion: string;
  modulo: string;
  objeto_tipo: string;
  objeto_id: string;
  cambios: Record<string, unknown> | null;
  motivo: string;
  resultado: EntradaBitacora["resultado"];
  origen: EntradaBitacora["origen"];
  hash_anterior: string;
  hash: string;
}

const empresaDeFila = (r: EmpresaRow): Empresa => ({ id: r.id, nombre: r.nombre, nit: r.nit, dv: r.dv, activa: r.activa, version: r.version, creado: r.creado, creadoPor: r.creado_por });
const licenciaDeFila = (r: LicenciaRow): Licencia => ({
  id: r.id,
  empresaId: r.empresa_id,
  evento: r.evento,
  plan: r.plan,
  desde: r.desde,
  hasta: r.hasta,
  maxProyectos: r.max_proyectos,
  maxUsuarios: r.max_usuarios,
  grupos: (r.grupos ?? []) as GrupoLicencia[],
  suspendida: r.suspendida,
  motivo: r.motivo,
  soporte: r.soporte,
  otorgadaPor: r.otorgada_por,
  creado: r.creado,
});
const proyectoDeFila = (r: ProyectoRow): ProyectoEmpresa => ({
  empresaId: r.empresa_id,
  projectId: r.project_id,
  projectName: r.project_name,
  activo: r.activo,
  vinculadoPor: r.vinculado_por,
  vinculado: r.vinculado,
  motivo: r.motivo,
});
const rolDeFila = (r: RolRow): Rol => ({ id: r.id, clave: r.clave, nombre: r.nombre, descripcion: r.descripcion, sistema: r.sistema, activo: r.activo, permisos: ordenar(r.permisos ?? []), version: r.version });
const usuarioDeFila = (r: UsuarioRow): UsuarioEmpresa => ({ id: r.id, userId: r.user_id, email: r.email, nombre: r.nombre, adminEmpresa: r.admin_empresa, activo: r.activo, version: r.version, otorgadoPor: r.otorgado_por });
const asignacionDeFila = (r: AsignacionRow): Asignacion => ({
  projectId: r.project_id,
  userId: r.user_id,
  nombre: r.nombre,
  email: r.email,
  rolId: r.rol_id,
  adminProyecto: r.admin_proyecto,
  desde: r.desde,
  hasta: r.hasta,
  activo: r.activo,
  version: r.version,
  otorgadoPor: r.otorgado_por,
});
const nivelDeFila = (r: NivelRow): Nivel => ({
  id: r.id,
  projectId: r.project_id,
  clave: r.clave,
  nombre: r.nombre,
  orden: r.orden,
  padreClave: r.padre_clave,
  fuente: r.fuente,
  claveFuente: r.clave_fuente,
  activo: r.activo,
  version: r.version,
});
const nodoDeFila = (r: NodoRow): Nodo => ({
  id: r.id,
  nivelClave: r.nivel_clave,
  valor: r.valor,
  padreId: r.padre_id,
  responsableId: r.responsable_id,
  responsableNombre: r.responsable_nombre,
  inicio: r.inicio,
  fin: r.fin,
  estado: r.estado,
  nota: r.nota,
  version: r.version,
});
const entradaDeFila = (r: BitacoraRow): EntradaBitacora => ({
  n: Number(r.n),
  cadena: r.cadena,
  creado: r.creado,
  empresaId: r.empresa_id,
  projectId: r.project_id,
  actorId: r.actor_id,
  actorNombre: r.actor_nombre,
  accion: r.accion,
  modulo: r.modulo,
  objetoTipo: r.objeto_tipo,
  objetoId: r.objeto_id,
  cambios: r.cambios ?? {},
  motivo: r.motivo,
  resultado: r.resultado,
  origen: r.origen,
  hashAnterior: r.hash_anterior,
  hash: r.hash,
});

const SEL_EMPRESA = "id,nombre,nit,dv,activa,version,creado,creado_por";
const SEL_LICENCIA = "id,empresa_id,evento,plan,desde,hasta,max_proyectos,max_usuarios,grupos,suspendida,motivo,soporte,otorgada_por,creado";
const SEL_PROYECTO = "empresa_id,project_id,project_name,activo,vinculado_por,vinculado,motivo";
const SEL_ROL = "id,clave,nombre,descripcion,sistema,activo,permisos,version";
const SEL_USUARIO = "id,user_id,email,nombre,admin_empresa,activo,version,otorgado_por";
const SEL_ASIGNACION = "project_id,user_id,nombre,email,rol_id,admin_proyecto,desde,hasta,activo,version,otorgado_por";
const SEL_NIVEL = "id,project_id,clave,nombre,orden,padre_clave,fuente,clave_fuente,activo,version";
const SEL_NODO = "id,nivel_clave,valor,padre_id,responsable_id,responsable_nombre,inicio,fin,estado,nota,version";
const SEL_FLUJO = "tipo,pasos,version,actualizado,actualizado_por";
const flujoDeFila = (r: FlujoRow): Flujo => ({ tipo: r.tipo, pasos: r.pasos, version: r.version, actualizado: r.actualizado, actualizadoPor: r.actualizado_por });
const SEL_BITACORA = "n,cadena,creado,empresa_id,project_id,actor_id,actor_nombre,accion,modulo,objeto_tipo,objeto_id,cambios,motivo,resultado,origen,hash_anterior,hash";

const INDICES_UNICOS: [RegExp, MotivoRechazo][] = [
  [/obra_empresas_nit/, "nit-repetido"],
  [/obra_empresas_nombre|obra_roles_nombre_unico/, "nombre-repetido"],
  [/obra_niveles_clave/, "clave-repetida"],
  [/obra_nodos_valor/, "valor-repetido"],
  [/obra_usuarios_empresa_id_email_key/, "correo-repetido"],
  [/obra_proyecto_una_empresa/, "ya-vinculado"],
];

/** Exported for the isolation test, which checks the URLs and bodies it sends. */
export function supabaseStore(): ObraStore | null {
  const db = clienteSupabase((_status, body, detail) => {
    // The SQL functions refuse with "obra:<reason>".
    const motivo = /obra:([a-z-]+)/.exec(detail.message ?? body)?.[1];
    if (motivo && esMotivo(motivo)) return rechazo(motivo);
    if (/version-conflict/.test(body)) return rechazo("version-conflict");
    if (detail.code === "23505") {
      for (const [re, m] of INDICES_UNICOS) if (re.test(body)) return rechazo(m);
      return rechazo("datos");
    }
    if (faltaTabla(body)) return new StoreError(SETUP_HINT);
    if (detail.code && /^(22\w{3}|23\w{3})$/.test(detail.code)) return rechazo("datos");
    return null;
  });
  if (!db) return null;
  const { call, json, all } = db;
  const rpc = <T>(fn: string, body: unknown) => json<T>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });
  const rpcVoid = async (fn: string, body: unknown) => {
    await call(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });
  };
  const deEmpresa = (empresaId: string) => `empresa_id=${eq(empresaId)}`;
  const deAlcance = (a: Alcance) => `empresa_id=${eq(a.empresaId)}&project_id=${eq(a.projectId)}`;

  return {
    async proyectoActivo(projectId) {
      const rows = await json<ProyectoRow[]>(`/obra_empresa_proyectos?project_id=${eq(projectId)}&activo=is.true&select=${SEL_PROYECTO}`);
      return rows[0] ? proyectoDeFila(rows[0]) : null;
    },
    async membresias(userId) {
      const rows = await all<UsuarioRow & { empresa_id: string; obra_empresas: EmpresaRow }>(
        `/obra_usuarios?user_id=${eq(userId)}&select=${SEL_USUARIO},empresa_id,obra_empresas(${SEL_EMPRESA})&order=empresa_id.asc`
      );
      return rows.map((r) => ({ empresa: empresaDeFila(r.obra_empresas), usuario: usuarioDeFila(r) }));
    },
    vincularUsuario: (email, userId, nombre) => rpc<number>("obra_vincular_usuario", { p_email: email, p_user_id: userId, p_nombre: nombre }),

    async getEmpresa(empresaId) {
      const rows = await json<EmpresaRow[]>(`/obra_empresas?id=${eq(empresaId)}&select=${SEL_EMPRESA}`);
      return rows[0] ? empresaDeFila(rows[0]) : null;
    },
    async listLicencias(empresaId) {
      return (await all<LicenciaRow>(`/obra_licencias?${deEmpresa(empresaId)}&select=${SEL_LICENCIA}&order=creado.asc,id.asc`)).map(licenciaDeFila);
    },
    async listRoles(empresaId) {
      return (await all<RolRow>(`/obra_roles?${deEmpresa(empresaId)}&select=${SEL_ROL}&order=sistema.desc,nombre.asc`)).map(rolDeFila);
    },
    async listUsuarios(empresaId) {
      return (await all<UsuarioRow>(`/obra_usuarios?${deEmpresa(empresaId)}&select=${SEL_USUARIO}&order=nombre.asc`)).map(usuarioDeFila);
    },
    async listProyectos(empresaId) {
      return (await all<ProyectoRow>(`/obra_empresa_proyectos?${deEmpresa(empresaId)}&select=${SEL_PROYECTO}&order=project_name.asc`)).map(proyectoDeFila);
    },
    async asignacionesDe(empresaId, userId) {
      return (await all<AsignacionRow>(`/obra_asignaciones?${deEmpresa(empresaId)}&user_id=${eq(userId)}&select=${SEL_ASIGNACION}&order=project_id.asc`)).map(asignacionDeFila);
    },
    async listPlantilla(empresaId) {
      return (await all<NivelRow>(`/obra_niveles?${deEmpresa(empresaId)}&project_id=is.null&select=${SEL_NIVEL}&order=orden.asc`)).map(nivelDeFila);
    },

    async listAsignaciones(a) {
      return (await all<AsignacionRow>(`/obra_asignaciones?${deAlcance(a)}&select=${SEL_ASIGNACION}&order=nombre.asc`)).map(asignacionDeFila);
    },
    async getConfig(a) {
      const rows = await json<
        { responsable_tecnico_id: string | null; responsable_tecnico_nombre: string; tolerancia_verificacion_pct: number | string; permite_aceptado_con_observaciones: boolean; version: number }[]
      >(`/obra_config?${deAlcance(a)}&select=responsable_tecnico_id,responsable_tecnico_nombre,tolerancia_verificacion_pct,permite_aceptado_con_observaciones,version`);
      const r = rows[0];
      return r
        ? {
            responsableTecnicoId: r.responsable_tecnico_id,
            responsableTecnicoNombre: r.responsable_tecnico_nombre,
            toleranciaVerificacionPct: Number(r.tolerancia_verificacion_pct),
            permiteAceptadoConObservaciones: r.permite_aceptado_con_observaciones,
            version: r.version,
          }
        : { ...CONFIG_INICIAL };
    },
    async listNivelesProyecto(a) {
      return (await all<NivelRow>(`/obra_niveles?${deAlcance(a)}&select=${SEL_NIVEL}&order=orden.asc`)).map(nivelDeFila);
    },
    async listNodos(a) {
      return (await all<NodoRow>(`/obra_nodos?${deAlcance(a)}&select=${SEL_NODO}&order=nivel_clave.asc,valor.asc`)).map(nodoDeFila);
    },

    vincularProyecto: (empresaId, projectId, projectName, actor) =>
      rpcVoid("obra_vincular_proyecto", { p_empresa_id: empresaId, p_project_id: projectId, p_project_name: projectName, p_actor_id: actor.id, p_actor_nombre: actor.nombre }),
    desvincularProyecto: (a, actor, motivo) =>
      rpcVoid("obra_desvincular_proyecto", { p_empresa_id: a.empresaId, p_project_id: a.projectId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_motivo: motivo }),
    guardarRol: (empresaId, actor, c) =>
      rpc<number>("obra_guardar_rol", {
        p_empresa_id: empresaId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: c.id,
        p_nombre: c.nombre,
        p_descripcion: c.descripcion,
        p_permisos: c.permisos,
        p_activo: c.activo,
        p_version: c.version,
      }),
    guardarUsuario: (empresaId, actor, id, activo, version) =>
      rpc<number>("obra_guardar_usuario", { p_empresa_id: empresaId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_id: id, p_activo: activo, p_version: version }),
    guardarAsignacion: (a, actor, persona, c) =>
      rpc<number>("obra_guardar_asignacion", {
        p_empresa_id: a.empresaId,
        p_project_id: a.projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_user_id: c.userId,
        p_nombre: persona.nombre,
        p_email: persona.email,
        p_rol_id: c.rolId,
        p_admin_proyecto: c.adminProyecto,
        p_desde: c.desde,
        p_hasta: c.hasta,
        p_activo: c.activo,
        p_version: c.version,
      }),
    guardarConfig: (a, actor, c, version) =>
      rpc<number>("obra_guardar_config", {
        p_empresa_id: a.empresaId,
        p_project_id: a.projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_responsable_id: c.responsableTecnicoId,
        p_responsable_nombre: c.responsableTecnicoNombre,
        p_tolerancia: c.toleranciaVerificacionPct,
        p_permite_obs: c.permiteAceptadoConObservaciones,
        p_version: version,
      }),
    guardarNivel: (empresaId, projectId, actor, c) =>
      rpc<number>("obra_guardar_nivel", {
        p_empresa_id: empresaId,
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: c.id,
        p_clave: c.clave,
        p_nombre: c.nombre,
        p_orden: c.orden,
        p_padre_clave: c.padreClave,
        p_fuente: c.fuente,
        p_clave_fuente: c.claveFuente,
        p_activo: c.activo,
        p_version: c.version,
      }),
    guardarNodo: (a, actor, c) =>
      rpc<number>("obra_guardar_nodo", {
        p_empresa_id: a.empresaId,
        p_project_id: a.projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: c.id,
        p_nivel_clave: c.nivelClave,
        p_valor: c.valor,
        p_padre_id: c.padreId,
        p_responsable_id: c.responsableId,
        p_responsable_nombre: c.responsableNombre,
        p_inicio: c.inicio,
        p_fin: c.fin,
        p_estado: c.estado,
        p_nota: c.nota,
        p_version: c.version,
      }),

    async listFlujos(a) {
      return (await all<FlujoRow>(`/obra_flujos?${deAlcance(a)}&select=${SEL_FLUJO}&order=tipo.asc`)).map(flujoDeFila);
    },
    guardarFlujo: (a, actor, c) =>
      rpc<number>("obra_guardar_flujo", {
        p_empresa_id: a.empresaId,
        p_project_id: a.projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_tipo: c.tipo,
        p_pasos: c.pasos.map((x) => ({ nombre: x.nombre, rolId: x.rolId })),
        p_version: c.version,
      }),

    async registrar(e) {
      await call("/obra_bitacora", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          empresa_id: e.empresaId,
          project_id: e.projectId,
          actor_id: e.actorId,
          actor_nombre: e.actorNombre,
          accion: e.accion,
          modulo: e.modulo,
          objeto_tipo: e.objetoTipo,
          objeto_id: e.objetoId,
          cambios: e.cambios,
          motivo: e.motivo,
          resultado: e.resultado,
          origen: e.origen,
          // Set by the database's trigger (position, time and chain).
          hash_anterior: "",
          hash: "",
        }),
      });
    },
    async listBitacora(empresaId, projectId, f) {
      const q = [`cadena=${eq(cadenaDe(empresaId))}`];
      if (empresaId) q.push(deEmpresa(empresaId));
      if (projectId) q.push(`project_id=${eq(projectId)}`);
      if (f.desde) q.push(`creado=gte.${encodeURIComponent(inicioDia(f.desde))}`);
      if (f.hasta) q.push(`creado=lt.${encodeURIComponent(inicioDia(diaSiguiente(f.hasta)))}`);
      if (f.actorId) q.push(`actor_id=${eq(f.actorId)}`);
      if (f.modulo) q.push(`modulo=${eq(f.modulo)}`);
      if (f.resultado) q.push(`resultado=${eq(f.resultado)}`);
      if (f.antesDe) q.push(`n=lt.${Math.floor(f.antesDe)}`);
      const limite = Math.min(f.limite ?? MAX_BITACORA, MAX_BITACORA);
      return (await json<BitacoraRow[]>(`/obra_bitacora?${q.join("&")}&select=${SEL_BITACORA}&order=n.desc&limit=${limite}`)).map(entradaDeFila);
    },
    async verificarBitacora(cadena) {
      const rows = await rpc<{ filas: number | string; rota_en: number | string | null }[]>("obra_bitacora_verificar", { p_cadena: cadena });
      const r = rows[0] ?? { filas: 0, rota_en: null };
      return { cadena, filas: Number(r.filas), integra: r.rota_en === null, rotaEn: r.rota_en === null ? null : Number(r.rota_en) };
    },

    async listEmpresas() {
      return (await all<EmpresaRow>(`/obra_empresas?select=${SEL_EMPRESA}&order=nombre.asc`)).map(empresaDeFila);
    },
    guardarEmpresa: (actor, e, roles, niveles) =>
      rpc<number>("obra_guardar_empresa", {
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: e.id,
        p_nombre: e.nombre,
        p_nit: e.nit,
        p_dv: e.dv,
        p_activa: e.activa,
        p_version: e.version,
        p_roles: roles,
        p_niveles: niveles,
      }),
    registrarLicencia: (actor, id, l) =>
      rpcVoid("obra_registrar_licencia", {
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_empresa_id: l.empresaId,
        p_evento: l.evento,
        p_plan: l.plan,
        p_desde: l.desde,
        p_hasta: l.hasta,
        p_max_proyectos: l.maxProyectos,
        p_max_usuarios: l.maxUsuarios,
        p_grupos: l.grupos,
        p_suspendida: l.suspendida,
        p_motivo: l.motivo,
        p_soporte: l.soporte,
      }),
    guardarAdminEmpresa: (actor, empresaId, email, nombre, admin) =>
      rpcVoid("obra_guardar_admin_empresa", { p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_empresa_id: empresaId, p_email: email, p_nombre: nombre, p_admin: admin }),
  };
}

// ---------------------------------------------------------------- memory

/**
 * The same rules as supabase/control-obra.sql, in memory: for `next dev` without
 * a database, the temporary preview page and the tests.
 */
export function memoryStore(hoy: () => string = () => hoyIso()): ObraStore {
  const empresas = new Map<string, Empresa>();
  const licencias: Licencia[] = [];
  const proyectos: ProyectoEmpresa[] = [];
  const roles = new Map<string, Rol & { empresaId: string }>();
  const usuarios = new Map<string, UsuarioEmpresa & { empresaId: string }>();
  const asignaciones: (Asignacion & { empresaId: string })[] = [];
  const configs = new Map<string, ConfigProyecto>();
  const niveles = new Map<string, Nivel & { empresaId: string }>();
  const nodos = new Map<string, Nodo & { empresaId: string; projectId: string }>();
  const flujos = new Map<string, Flujo & { empresaId: string; projectId: string }>();
  const bitacora: EntradaBitacora[] = [];
  /** One insertion at a time per chain (like the advisory lock of the SQL trigger). */
  const colas = new Map<string, Promise<void>>();
  let reloj = 0;
  /** Distinct, increasing times (rows inserted together must keep their order). */
  const ahora = () => {
    reloj = Math.max(Date.now(), reloj + 1);
    return new Date(reloj).toISOString();
  };
  const copia = <T>(x: T): T => structuredClone(x);
  const sin = <T extends object, K extends keyof T>(x: T, ...k: K[]): Omit<T, K> => {
    const out = copia(x) as Record<string, unknown>;
    for (const key of k) delete out[key as string];
    return out as Omit<T, K>;
  };

  const licenciasDe = (empresaId: string) => licencias.filter((l) => l.empresaId === empresaId);
  const usuariosDe = (empresaId: string): UsuarioEmpresa[] => [...usuarios.values()].filter((u) => u.empresaId === empresaId).map((u) => sin(u, "empresaId"));
  const rolesDe = (empresaId: string): Rol[] => [...roles.values()].filter((r) => r.empresaId === empresaId).map((r) => sin(r, "empresaId"));
  const asignacionesDeProyecto = (a: Alcance): Asignacion[] => asignaciones.filter((x) => x.empresaId === a.empresaId && x.projectId === a.projectId).map((x) => sin(x, "empresaId"));
  const vinculado = (a: Alcance) => proyectos.some((p) => p.empresaId === a.empresaId && p.projectId === a.projectId && p.activo);
  const usable = (empresaId: string) => {
    const e = empresas.get(empresaId);
    return !!e && licenciaPermiteTrabajar(estadoLicencia(licenciaVigente(licenciasDe(empresaId)), e.activa, hoy()).estado);
  };
  const esAdminE = (empresaId: string, userId: string) => {
    const u = usuarioDe(usuariosDe(empresaId), userId);
    return usable(empresaId) && !!u && u.activo && u.adminEmpresa;
  };
  const esAdminP = (a: Alcance, userId: string) =>
    usable(a.empresaId) && vinculado(a) && !!asignacionVigente(userId, asignacionesDeProyecto(a), usuariosDe(a.empresaId), hoy())?.adminProyecto;
  const maxUsuarios = (empresaId: string) => licenciaVigente(licenciasDe(empresaId))?.maxUsuarios ?? 0;

  async function registrar(e: NuevaEntrada) {
    const cadena = cadenaDe(e.empresaId);
    const previa = colas.get(cadena) ?? Promise.resolve();
    const hecha = previa.then(async () => {
      const ultima = bitacora.filter((b) => b.cadena === cadena).sort((a, b) => b.n - a.n)[0];
      const fila = { ...copia(e), n: (ultima?.n ?? 0) + 1, cadena, creado: ahora() };
      const hashAnterior = ultima?.hash ?? HASH_INICIAL;
      bitacora.push({ ...fila, hashAnterior, hash: await hashDe(hashAnterior, fila) });
    });
    colas.set(cadena, hecha.catch(() => {}));
    await hecha;
  }
  const ok = (empresaId: string | null, projectId: string | null, actor: Actor, accion: string, modulo: string, objetoTipo: string, objetoId: string, cambios: Record<string, unknown>, motivo = "") =>
    registrar({ empresaId, projectId, actorId: actor.id, actorNombre: actor.nombre, accion, modulo, objetoTipo, objetoId, cambios, motivo, resultado: "ok", origen: "menu" });

  /** The level in force in a project with this key: the project's own or the template's. */
  const nivelEfectivo = (a: Alcance, clave: string) => {
    const delProyecto = [...niveles.values()].find((n) => n.empresaId === a.empresaId && n.projectId === a.projectId && n.clave === clave);
    return delProyecto ?? [...niveles.values()].find((n) => n.empresaId === a.empresaId && n.projectId === null && n.clave === clave);
  };

  return {
    async proyectoActivo(projectId) {
      const p = proyectos.find((x) => x.projectId === projectId && x.activo);
      return p ? copia(p) : null;
    },
    async membresias(userId) {
      return [...usuarios.values()]
        .filter((u) => u.userId === userId && empresas.has(u.empresaId))
        .map((u) => ({ empresa: copia(empresas.get(u.empresaId)!), usuario: sin(u, "empresaId") }));
    },
    async vincularUsuario(email, userId, nombre) {
      let n = 0;
      for (const u of usuarios.values()) {
        if (u.email !== email.trim().toLowerCase() || u.userId !== null) continue;
        if (usuarioDe(usuariosDe(u.empresaId), userId)) continue;
        Object.assign(u, { userId, nombre: u.nombre || nombre.trim(), version: u.version + 1 });
        await ok(u.empresaId, null, { id: userId, nombre }, "usuarios.vincular", "accesos", "usuario", u.email, { email: u.email });
        n++;
      }
      return n;
    },

    async getEmpresa(empresaId) {
      const e = empresas.get(empresaId);
      return e ? copia(e) : null;
    },
    async listLicencias(empresaId) {
      return copia(licenciasDe(empresaId));
    },
    async listRoles(empresaId) {
      return rolesDe(empresaId).sort((a, b) => Number(b.sistema) - Number(a.sistema) || a.nombre.localeCompare(b.nombre, "es"));
    },
    async listUsuarios(empresaId) {
      return usuariosDe(empresaId).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    },
    async listProyectos(empresaId) {
      return copia(proyectos.filter((p) => p.empresaId === empresaId));
    },
    async asignacionesDe(empresaId, userId) {
      return asignaciones.filter((x) => x.empresaId === empresaId && x.userId === userId).map((x) => sin(x, "empresaId"));
    },
    async listPlantilla(empresaId) {
      return [...niveles.values()].filter((n) => n.empresaId === empresaId && n.projectId === null).map((n) => sin(n, "empresaId")).sort((a, b) => a.orden - b.orden);
    },

    async listAsignaciones(a) {
      return asignacionesDeProyecto(a).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    },
    async getConfig(a) {
      return copia(configs.get(`${a.empresaId}|${a.projectId}`) ?? CONFIG_INICIAL);
    },
    async listNivelesProyecto(a) {
      return [...niveles.values()].filter((n) => n.empresaId === a.empresaId && n.projectId === a.projectId).map((n) => sin(n, "empresaId")).sort((x, y) => x.orden - y.orden);
    },
    async listNodos(a) {
      return [...nodos.values()].filter((n) => n.empresaId === a.empresaId && n.projectId === a.projectId).map((n) => sin(n, "empresaId", "projectId"));
    },

    async vincularProyecto(empresaId, projectId, projectName, actor) {
      if (!usable(empresaId)) throw rechazo("licencia-no-vigente");
      if (!esAdminE(empresaId, actor.id)) throw rechazo("solo-admin-empresa");
      if (proyectos.some((p) => p.projectId === projectId && p.activo)) throw rechazo("ya-vinculado");
      const max = licenciaVigente(licenciasDe(empresaId))!.maxProyectos;
      if (proyectos.filter((p) => p.empresaId === empresaId && p.activo).length >= max) throw rechazo("cupo-proyectos");
      const antes = proyectos.find((p) => p.empresaId === empresaId && p.projectId === projectId);
      const nuevo = { empresaId, projectId, projectName, activo: true, vinculadoPor: actor.nombre, vinculado: ahora(), motivo: "" };
      if (antes) Object.assign(antes, nuevo);
      else proyectos.push(nuevo);
      await ok(empresaId, projectId, actor, "proyecto.vincular", "accesos", "proyecto", projectId, { proyecto: projectName });
    },
    async desvincularProyecto(a, actor, motivo) {
      if (!esAdminE(a.empresaId, actor.id)) throw rechazo("solo-admin-empresa");
      if (!motivo.trim()) throw rechazo("motivo-requerido");
      const p = proyectos.find((x) => x.empresaId === a.empresaId && x.projectId === a.projectId && x.activo);
      if (!p) throw rechazo("sin-empresa");
      Object.assign(p, { activo: false, motivo: motivo.trim() });
      await ok(a.empresaId, a.projectId, actor, "proyecto.desvincular", "accesos", "proyecto", a.projectId, {}, motivo.trim());
    },
    async guardarRol(empresaId, actor, c) {
      if (!esAdminE(empresaId, actor.id)) throw rechazo("solo-admin-empresa");
      if (asignaciones.some((x) => x.empresaId === empresaId && x.userId === actor.id && x.rolId === c.id && x.activo)) throw rechazo("propio");
      const antes = roles.get(c.id);
      if (antes && antes.empresaId !== empresaId) throw rechazo("otra-empresa");
      if (antes?.sistema && !c.activo) throw rechazo("rol-protegido");
      if (rolesDe(empresaId).some((r) => r.id !== c.id && r.nombre.trim().toLowerCase() === c.nombre.trim().toLowerCase())) throw rechazo("nombre-repetido");
      if ((antes?.version ?? 0) !== c.version) throw rechazo("version-conflict");
      const version = c.version + 1;
      roles.set(c.id, {
        empresaId,
        id: c.id,
        clave: antes?.clave ?? `personal_${c.id.replace(/-/g, "").slice(0, 12)}`,
        nombre: c.nombre.trim(),
        descripcion: c.descripcion,
        sistema: antes?.sistema ?? false,
        activo: c.activo,
        permisos: ordenar(c.permisos),
        version,
      });
      const previos = antes?.permisos ?? [];
      await ok(empresaId, null, actor, antes ? "roles.cambiar" : "roles.crear", "accesos", "rol", c.id, {
        nombre: c.nombre.trim(),
        agregados: c.permisos.filter((p) => !previos.includes(p)),
        quitados: previos.filter((p) => !c.permisos.includes(p)),
        activo: c.activo,
      });
      return version;
    },
    async guardarUsuario(empresaId, actor, id, activo, version) {
      if (!esAdminE(empresaId, actor.id)) throw rechazo("solo-admin-empresa");
      const u = usuarios.get(id);
      if (!u || u.empresaId !== empresaId) throw rechazo("no-existe");
      if (u.userId === actor.id) throw rechazo("propio");
      if (u.adminEmpresa) throw rechazo("es-administrador");
      if (activo && !u.activo && usuariosDe(empresaId).filter((x) => x.activo).length >= maxUsuarios(empresaId)) throw rechazo("cupo-usuarios");
      if (u.version !== version) throw rechazo("version-conflict");
      Object.assign(u, { activo, version: version + 1 });
      await ok(empresaId, null, actor, activo ? "usuarios.activar" : "usuarios.desactivar", "accesos", "usuario", u.userId ?? u.email, { persona: u.nombre || u.email });
      return version + 1;
    },
    async guardarAsignacion(a, actor, persona, c) {
      if (!vinculado(a)) throw rechazo("sin-empresa");
      const adminE = esAdminE(a.empresaId, actor.id);
      if (!adminE && !esAdminP(a, actor.id)) throw rechazo("no-admin");
      if (c.userId === actor.id) throw rechazo("propio");
      const rol = roles.get(c.rolId);
      if (!rol || rol.empresaId !== a.empresaId || (c.activo && !rol.activo)) throw rechazo("rol-no-valido");
      const antes = asignaciones.find((x) => x.empresaId === a.empresaId && x.projectId === a.projectId && x.userId === c.userId);
      if (!adminE) {
        if (c.adminProyecto) throw rechazo("solo-admin-empresa");
        if (antes?.adminProyecto) throw rechazo("es-administrador");
      }
      const email = persona.email.trim().toLowerCase();
      let u = [...usuarios.values()].find((x) => x.empresaId === a.empresaId && x.userId === c.userId);
      if (!u && email) {
        u = [...usuarios.values()].find((x) => x.empresaId === a.empresaId && x.email === email && x.userId === null);
        if (u) Object.assign(u, { userId: c.userId, version: u.version + 1 });
      }
      if (!u) {
        if (c.activo && superaCupoUsuarios(usuariosDe(a.empresaId), c.userId, maxUsuarios(a.empresaId))) throw rechazo("cupo-usuarios");
        if (!email) throw rechazo("datos");
        if ([...usuarios.values()].some((x) => x.empresaId === a.empresaId && x.email === email)) throw rechazo("correo-repetido");
        const id = globalThis.crypto.randomUUID();
        usuarios.set(id, { empresaId: a.empresaId, id, userId: c.userId, email, nombre: persona.nombre.trim(), adminEmpresa: false, activo: true, version: 1, otorgadoPor: actor.nombre });
      } else if (!u.activo && c.activo) throw rechazo("usuario-inactivo");
      if ((antes?.version ?? 0) !== c.version) throw rechazo("version-conflict");
      const version = c.version + 1;
      const fila = {
        empresaId: a.empresaId,
        projectId: a.projectId,
        userId: c.userId,
        nombre: persona.nombre.trim() || antes?.nombre || "",
        email: email || antes?.email || "",
        rolId: c.rolId,
        adminProyecto: c.adminProyecto,
        desde: c.desde,
        hasta: c.hasta,
        activo: c.activo,
        version,
        otorgadoPor: antes?.otorgadoPor ?? actor.nombre,
      };
      if (antes) Object.assign(antes, fila);
      else asignaciones.push(fila);
      const nombreRol = (id: string | undefined) => (id ? roles.get(id)?.nombre ?? "" : "");
      await ok(a.empresaId, a.projectId, actor, !antes ? "accesos.asignar" : !c.activo ? "accesos.revocar" : "accesos.cambiar", "accesos", "usuario", c.userId, {
        persona: fila.nombre || c.userId,
        antes: antes ? { rol: nombreRol(antes.rolId), adminProyecto: antes.adminProyecto, desde: antes.desde, hasta: antes.hasta, activo: antes.activo } : null,
        despues: { rol: rol.nombre, adminProyecto: c.adminProyecto, desde: c.desde, hasta: c.hasta, activo: c.activo },
      });
      return version;
    },
    async guardarConfig(a, actor, c, version) {
      if (!esAdminE(a.empresaId, actor.id) && !esAdminP(a, actor.id)) throw rechazo("no-admin");
      const k = `${a.empresaId}|${a.projectId}`;
      const antes = configs.get(k);
      if ((antes?.version ?? 0) !== version) throw rechazo("version-conflict");
      configs.set(k, { ...copia(c), version: version + 1 });
      await ok(a.empresaId, a.projectId, actor, "config.cambiar", "estructura", "proyecto", a.projectId, {
        responsableTecnico: [antes?.responsableTecnicoNombre ?? null, c.responsableTecnicoNombre],
        toleranciaVerificacionPct: [antes?.toleranciaVerificacionPct ?? null, c.toleranciaVerificacionPct],
        permiteAceptadoConObservaciones: [antes?.permiteAceptadoConObservaciones ?? null, c.permiteAceptadoConObservaciones],
      });
      return version + 1;
    },
    async guardarNivel(empresaId, projectId, actor, c) {
      if (projectId === null) {
        if (!esAdminE(empresaId, actor.id)) throw rechazo("solo-admin-empresa");
      } else {
        const a = { empresaId, projectId };
        if (!vinculado(a)) throw rechazo("sin-empresa");
        if (!esAdminE(empresaId, actor.id) && !esAdminP(a, actor.id)) throw rechazo("no-admin");
      }
      if (c.padreClave !== null) {
        const enAlcance = (clave: string) =>
          (projectId ? [...niveles.values()].find((n) => n.empresaId === empresaId && n.projectId === projectId && n.clave === clave && n.activo) : undefined) ??
          [...niveles.values()].find((n) => n.empresaId === empresaId && n.projectId === null && n.clave === clave && n.activo);
        let actual: string | null = c.padreClave;
        for (let pasos = 0; actual !== null; pasos++) {
          if (actual === c.clave || pasos > 50) throw rechazo("padre-no-valido");
          const n = enAlcance(actual);
          if (!n) throw rechazo("padre-no-valido");
          actual = n.padreClave;
        }
      }
      const antes = niveles.get(c.id);
      if (antes && (antes.empresaId !== empresaId || antes.projectId !== projectId)) throw rechazo("otra-empresa");
      if (antes && antes.clave !== c.clave) throw rechazo("datos");
      if ([...niveles.values()].some((n) => n.id !== c.id && n.empresaId === empresaId && n.projectId === projectId && n.clave === c.clave)) throw rechazo("clave-repetida");
      if ((antes?.version ?? 0) !== c.version) throw rechazo("version-conflict");
      const version = c.version + 1;
      niveles.set(c.id, { ...copia(c), nombre: c.nombre.trim(), projectId, empresaId, version });
      await ok(empresaId, projectId, actor, antes ? "estructura.nivel.cambiar" : "estructura.nivel.crear", "estructura", "nivel", c.clave, {
        alcance: projectId === null ? "plantilla" : "proyecto",
        nombre: c.nombre.trim(),
        fuente: c.fuente,
        claveFuente: c.claveFuente,
        padre: c.padreClave,
        activo: c.activo,
        antes: antes ? { nombre: antes.nombre, fuente: antes.fuente, claveFuente: antes.claveFuente, padre: antes.padreClave, activo: antes.activo } : null,
      });
      return version;
    },
    async guardarNodo(a, actor, c) {
      if (!vinculado(a)) throw rechazo("sin-empresa");
      if (!esAdminE(a.empresaId, actor.id) && !esAdminP(a, actor.id)) throw rechazo("no-admin");
      const nivel = nivelEfectivo(a, c.nivelClave);
      if (!nivel || !nivel.activo) throw rechazo("nivel-no-valido");
      if (c.padreId !== null) {
        const padre = nodos.get(c.padreId);
        if (!padre || padre.empresaId !== a.empresaId || padre.projectId !== a.projectId || nivel.padreClave === null || padre.nivelClave !== nivel.padreClave) {
          throw rechazo("padre-no-valido");
        }
      }
      const antes = nodos.get(c.id);
      if (antes && (antes.empresaId !== a.empresaId || antes.projectId !== a.projectId)) throw rechazo("otra-empresa");
      if (antes && antes.nivelClave !== c.nivelClave) throw rechazo("datos");
      const v = c.valor.trim().toLowerCase();
      if ([...nodos.values()].some((n) => n.id !== c.id && n.empresaId === a.empresaId && n.projectId === a.projectId && n.nivelClave === c.nivelClave && n.valor.trim().toLowerCase() === v)) {
        throw rechazo("valor-repetido");
      }
      if ((antes?.version ?? 0) !== c.version) throw rechazo("version-conflict");
      const version = c.version + 1;
      nodos.set(c.id, { ...copia(c), valor: c.valor.trim(), responsableNombre: c.responsableNombre.trim(), empresaId: a.empresaId, projectId: a.projectId, version });
      await ok(a.empresaId, a.projectId, actor, antes ? "estructura.nodo.cambiar" : "estructura.nodo.crear", "estructura", "nodo", c.id, {
        nivel: c.nivelClave,
        valor: c.valor.trim(),
        responsable: c.responsableNombre.trim(),
        inicio: c.inicio,
        fin: c.fin,
        estado: c.estado,
        antes: antes ? { valor: antes.valor, responsable: antes.responsableNombre, inicio: antes.inicio, fin: antes.fin, estado: antes.estado } : null,
      });
      return version;
    },

    async listFlujos(a) {
      return [...flujos.values()]
        .filter((f) => f.empresaId === a.empresaId && f.projectId === a.projectId)
        .map((f) => sin(f, "empresaId", "projectId"))
        .sort((x, y) => x.tipo.localeCompare(y.tipo));
    },
    async guardarFlujo(a, actor, c) {
      if (!vinculado(a)) throw rechazo("sin-empresa");
      if (!esAdminE(a.empresaId, actor.id) && !esAdminP(a, actor.id)) throw rechazo("no-admin");
      const tipo = TIPOS_FLUJO.find((t) => t.id === c.tipo);
      if (!tipo) throw rechazo("datos");
      if (!modulosHabilitados(licenciaVigente(licenciasDe(a.empresaId))?.grupos ?? []).has(tipo.modulo)) throw rechazo("modulo-no-contratado");
      if (c.pasos.length < 2 || c.pasos.length > 6) throw rechazo("flujo-no-valido");
      const pasos = c.pasos.map((x, i) => {
        const rol = roles.get(x.rolId);
        const nombre = x.nombre.trim();
        if (!nombre || nombre.length > 40 || !rol || rol.empresaId !== a.empresaId || !rol.activo || !rol.permisos.includes(permisoDePaso(c.tipo, i))) throw rechazo("flujo-no-valido");
        return { nombre, rolId: x.rolId };
      });
      const k = `${a.empresaId}|${a.projectId}|${c.tipo}`;
      const antes = flujos.get(k);
      if ((antes?.version ?? 0) !== c.version) throw rechazo("version-conflict");
      const version = c.version + 1;
      flujos.set(k, { empresaId: a.empresaId, projectId: a.projectId, tipo: c.tipo, pasos, version, actualizado: ahora(), actualizadoPor: actor.nombre });
      const nombres = (l: { nombre: string; rolId: string }[]) => l.map((x) => ({ nombre: x.nombre, rol: roles.get(x.rolId)?.nombre ?? "" }));
      await ok(a.empresaId, a.projectId, actor, "flujos.cambiar", tipo.modulo, "flujo", c.tipo, { tipo: c.tipo, antes: antes ? nombres(antes.pasos) : null, despues: nombres(pasos) });
      return version;
    },

    registrar,
    async listBitacora(empresaId, projectId, f) {
      const cadena = cadenaDe(empresaId);
      const desde = f.desde ? Date.parse(inicioDia(f.desde)) : null;
      const hasta = f.hasta ? Date.parse(inicioDia(diaSiguiente(f.hasta))) : null;
      return bitacora
        .filter(
          (b) =>
            b.cadena === cadena &&
            (!projectId || b.projectId === projectId) &&
            (desde === null || Date.parse(b.creado) >= desde) &&
            (hasta === null || Date.parse(b.creado) < hasta) &&
            (!f.actorId || b.actorId === f.actorId) &&
            (!f.modulo || b.modulo === f.modulo) &&
            (!f.resultado || b.resultado === f.resultado) &&
            (!f.antesDe || b.n < f.antesDe)
        )
        .sort((a, b) => b.n - a.n)
        .slice(0, Math.min(f.limite ?? MAX_BITACORA, MAX_BITACORA))
        .map(copia);
    },
    async verificarBitacora(cadena) {
      await (colas.get(cadena) ?? Promise.resolve());
      return verificarCadena(cadena, bitacora.filter((b) => b.cadena === cadena));
    },

    async listEmpresas() {
      return [...empresas.values()].map(copia).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    },
    async guardarEmpresa(actor, e, iniciales, nivelesIniciales) {
      const antes = empresas.get(e.id);
      if (e.nit && [...empresas.values()].some((x) => x.id !== e.id && x.nit === e.nit)) throw rechazo("nit-repetido");
      if ([...empresas.values()].some((x) => x.id !== e.id && x.nombre.trim().toLowerCase() === e.nombre.trim().toLowerCase())) throw rechazo("nombre-repetido");
      if ((antes?.version ?? 0) !== e.version) throw rechazo("version-conflict");
      const version = e.version + 1;
      empresas.set(e.id, { id: e.id, nombre: e.nombre.trim(), nit: e.nit, dv: e.dv, activa: e.activa, version, creado: antes?.creado ?? ahora(), creadoPor: antes?.creadoPor ?? actor.nombre });
      if (!antes) {
        for (const r of iniciales) {
          const id = globalThis.crypto.randomUUID();
          roles.set(id, { empresaId: e.id, id, clave: r.clave, nombre: r.nombre, descripcion: r.descripcion, sistema: true, activo: true, permisos: ordenar(r.permisos), version: 1 });
        }
        for (const n of nivelesIniciales) {
          const id = globalThis.crypto.randomUUID();
          niveles.set(id, { ...copia(n), id, empresaId: e.id, projectId: null, version: 1 });
        }
        await ok(e.id, null, actor, "empresa.crear", "empresas", "empresa", e.id, { nombre: e.nombre.trim(), nit: e.nit, activa: e.activa, roles: iniciales.length });
      } else {
        const cambios: Record<string, unknown> = {};
        if (antes.nombre !== e.nombre.trim()) cambios.nombre = [antes.nombre, e.nombre.trim()];
        if (antes.nit !== e.nit) cambios.nit = [antes.nit, e.nit];
        if (antes.activa !== e.activa) cambios.activa = [antes.activa, e.activa];
        await ok(e.id, null, actor, "empresa.cambiar", "empresas", "empresa", e.id, cambios);
      }
      return version;
    },
    async registrarLicencia(actor, id, l) {
      if (!empresas.has(l.empresaId)) throw rechazo("no-existe");
      licencias.push({ ...copia(l), id, otorgadaPor: actor.nombre, creado: ahora() });
      await ok(
        l.empresaId,
        null,
        actor,
        "licencias.registrar",
        "empresas",
        "licencia",
        id,
        { evento: l.evento, plan: l.plan.trim(), desde: l.desde, hasta: l.hasta, maxProyectos: l.maxProyectos, maxUsuarios: l.maxUsuarios, grupos: l.grupos, suspendida: l.suspendida },
        l.motivo
      );
    },
    async guardarAdminEmpresa(actor, empresaId, email, nombre, admin) {
      if (!empresas.has(empresaId)) throw rechazo("no-existe");
      if (admin && !licenciaVigente(licenciasDe(empresaId))) throw rechazo("licencia-no-vigente");
      const correo = email.trim().toLowerCase();
      const antes = [...usuarios.values()].find((u) => u.empresaId === empresaId && u.email === correo);
      const activos = usuariosDe(empresaId).filter((u) => u.activo).length;
      if (!antes) {
        if (!admin) throw rechazo("no-existe");
        if (activos >= maxUsuarios(empresaId)) throw rechazo("cupo-usuarios");
        const id = globalThis.crypto.randomUUID();
        usuarios.set(id, { empresaId, id, userId: null, email: correo, nombre: nombre.trim(), adminEmpresa: true, activo: true, version: 1, otorgadoPor: actor.nombre });
      } else {
        if (admin && !antes.activo && activos >= maxUsuarios(empresaId)) throw rechazo("cupo-usuarios");
        Object.assign(antes, { adminEmpresa: admin, activo: admin ? true : antes.activo, nombre: nombre.trim() || antes.nombre, version: antes.version + 1 });
      }
      await ok(empresaId, null, actor, admin ? "administradores.nombrar" : "administradores.quitar", "empresas", "usuario", correo, {
        email: correo,
        adminEmpresa: [antes?.adminEmpresa ?? false, admin],
      });
    },
  };
}

/** What a person may do in a project today, from the company's data (the same rules as obra_permisos_de). */
export function permisosEfectivos(
  userId: string,
  d: { asignaciones: Asignacion[]; usuarios: UsuarioEmpresa[]; roles: Rol[]; licencias: Licencia[]; empresaActiva: boolean },
  hoy: string
): Permiso[] {
  const lic = licenciaVigente(d.licencias);
  if (!licenciaPermiteTrabajar(estadoLicencia(lic, d.empresaActiva, hoy).estado)) return [];
  const a = asignacionVigente(userId, d.asignaciones, d.usuarios, hoy);
  if (!a) return [];
  const rol = d.roles.find((r) => r.id === a.rolId);
  return rol && rol.activo ? permisosContratados(rol.permisos, lic?.grupos ?? []) : [];
}

let selected: ObraStore | null | undefined;
let devStore: ObraStore | undefined;

/** Supabase when it is configured; in development without it, memory. */
export function obraStore(): ObraStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError(
      "La base de datos de Control de Obra no está conectada. Conecta la integración de Supabase al proyecto en Vercel, ejecuta supabase/control-obra.sql y vuelve a desplegar."
    );
  }
  return (devStore ??= memoryStore());
}
