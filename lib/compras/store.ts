import { StoreError } from "../propiedades/store";
import { hoyIso } from "../manuales/licencia";
import { esMotivo, ESTADO_HTTP, MotivoRechazo, permisosVigentes, revisarAsignacion, revisarRol, tiene } from "./accesos";
import { evaluar, numeroCotizacion, revisarComparativo, revisarCotizacion, totalesCotizacion } from "./cotizaciones";
import { numeroOrden, revisarAccionOrden, revisarOrden, TRANSICIONES_ORDEN } from "./ordenes";
import { numeroRequisicion, puedeEditar, revisarAccion, TRANSICIONES } from "./requisiciones";
import type { RolInicial } from "./roles";
import { clienteSupabase, eq, faltaTabla } from "./supabase";
import {
  CarpetaCde,
  Documento,
  SyncEntrada,
  TipoDocumentoLegal,
  AccionSobreOrden,
  CambioOrden,
  LineaOrden,
  Orden,
  RevisionOrden,
  TIPO_ORDEN,
  AccionSobreComparativo,
  AccionSobreRequisicion,
  CambioCotizacion,
  Comparativo,
  Cotizacion,
  CRITERIOS_INICIALES,
  Criterios,
  DatosProveedor,
  EstadoProveedor,
  LineaCotizacion,
  Proveedor,
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
  guardarConfig(projectId: string, actor: Actor, config: Omit<ConfigCompras, "version">, version: number): Promise<number>;

  listProveedores(projectId: string): Promise<Proveedor[]>;
  /** Creates (version 0) or changes a supplier; returns its new version. */
  guardarProveedor(projectId: string, actor: Actor, id: string, datos: DatosProveedor & { dv: number }, version: number): Promise<number>;
  estadoProveedor(projectId: string, actor: Actor, id: string, estado: EstadoProveedor, motivo: string, version: number): Promise<number>;

  /** Every quotation of the project with its lines. */
  listCotizaciones(projectId: string): Promise<Cotizacion[]>;
  /** Registers (version 0) or corrects a quotation, replacing its lines. */
  guardarCotizacion(projectId: string, actor: Actor, id: string, cambio: Omit<CambioCotizacion, "lineas" | "id"> & { lineas: LineaCotizacion[] }): Promise<number>;
  anularCotizacion(projectId: string, actor: Actor, id: string, motivo: string, version: number): Promise<number>;
  listComparativos(projectId: string): Promise<Comparativo[]>;
  /** `requiereJustificacion`: what the scores say (the database also checks the minimum of quotations). */
  accionComparativo(projectId: string, actor: Actor, requisicionId: string, a: AccionSobreComparativo, requiereJustificacion: boolean): Promise<number>;

  /** Every purchase order and contract of the project with its lines. */
  listOrdenes(projectId: string): Promise<Orden[]>;
  /** What each approved order looked like before its modifications. */
  listRevisiones(projectId: string): Promise<RevisionOrden[]>;
  /** Creates (version 0) or changes a draft; lines come with the prices to save (the quotation's, in revision 0). */
  guardarOrden(projectId: string, actor: Actor, id: string, cambio: OrdenGuardada): Promise<number>;
  accionOrden(projectId: string, actor: Actor, id: string, a: AccionSobreOrden): Promise<number>;

  listCarpetasCde(projectId: string): Promise<CarpetaCde[]>;
  guardarCarpetaCde(projectId: string, carpeta: CarpetaCde): Promise<void>;
  /** The legal document kinds saved for the project (null: the initial ones) and the config version. */
  getTiposDocumento(projectId: string): Promise<{ tipos: TipoDocumentoLegal[] | null; version: number }>;
  guardarTiposDocumento(projectId: string, actor: Actor, tipos: TipoDocumentoLegal[], version: number): Promise<number>;
  listDocumentos(projectId: string, filtro: { entidadTipo?: Documento["entidadTipo"]; entidadId?: string; id?: string }): Promise<Documento[]>;
  crearDocumento(projectId: string, d: Documento): Promise<void>;
  /** Saves the changes if the stored version is still `version`; returns the document (null: someone changed it). */
  actualizarDocumento(projectId: string, id: string, cambios: Partial<Omit<Documento, "id" | "version">>, version: number, actor: Actor): Promise<Documento | null>;
  registrarSync(projectId: string, e: SyncEntrada): Promise<void>;
  listSync(projectId: string, documentoId: string): Promise<SyncEntrada[]>;

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
/** A draft of an order as saved, with the prices of each line. */
export type OrdenGuardada = Omit<CambioOrden, "lineas"> & { lineas: { requisicionLineaId: string; cantidad: number; precioUnitario: number; descuentoPct: number; ivaPct: number }[] };

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
    if (detail.code === "23505") {
      if (/compras_req_lineas_unica/.test(body)) return rechazo("linea-duplicada");
      if (/compras_proveedores_project_id_nit/.test(body)) return rechazo("nit-repetido");
      if (/compras_cotizaciones_una_por_proveedor/.test(body)) return rechazo("cotizacion-duplicada");
      if (/compras_documentos_nombre_unico/.test(body)) return rechazo("documento-duplicado");
      return rechazo("nombre-repetido");
    }
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
      const rows = await json<{ tolerancia_pct: number | string; min_cotizaciones: number; version: number }[]>(
        `/compras_config?project_id=${eq(projectId)}&select=tolerancia_pct,min_cotizaciones,version`
      );
      return rows[0] ? { toleranciaPct: Number(rows[0].tolerancia_pct), minCotizaciones: rows[0].min_cotizaciones, version: rows[0].version } : { ...CONFIG_INICIAL };
    },

    guardarConfig: (projectId, actor, c, version) =>
      rpc<number>("compras_guardar_config", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_tolerancia: c.toleranciaPct,
        p_min_cotizaciones: c.minCotizaciones,
        p_version: version,
      }),

    async listProveedores(projectId) {
      const rows = await all<ProveedorRow>(
        `/compras_proveedores?project_id=${eq(projectId)}&select=id,nit,dv,tipo_persona,razon_social,nombre_comercial,contacto,telefono,correo,ciudad,direccion,categorias,responsable_iva,observaciones,estado,motivo_estado,version,creado,creado_por,actualizado,actualizado_por&order=razon_social.asc`
      );
      return rows.map(proveedorDeFila);
    },

    guardarProveedor: (projectId, actor, id, d, version) =>
      rpc<number>("compras_guardar_proveedor", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_datos: {
          nit: d.nit,
          dv: d.dv,
          tipo_persona: d.tipoPersona,
          razon_social: d.razonSocial,
          nombre_comercial: d.nombreComercial,
          contacto: d.contacto,
          telefono: d.telefono,
          correo: d.correo,
          ciudad: d.ciudad,
          direccion: d.direccion,
          categorias: d.categorias,
          responsable_iva: d.responsableIva,
          observaciones: d.observaciones,
        },
        p_version: version,
      }),

    estadoProveedor: (projectId, actor, id, estado, motivo, version) =>
      rpc<number>("compras_estado_proveedor", { p_project_id: projectId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_id: id, p_estado: estado, p_motivo: motivo, p_version: version }),

    async listCotizaciones(projectId) {
      const [cots, lineas] = await Promise.all([
        all<CotizacionRow>(
          `/compras_cotizaciones?project_id=${eq(projectId)}&select=id,numero,requisicion_id,proveedor_id,referencia,fecha,vigencia_hasta,plazo_entrega_dias,dias_pago,anticipo_pct,forma_pago,observaciones,estado,motivo,version,creada,creada_por,actualizado,actualizado_por&order=numero.desc`
        ),
        all<CotizacionLineaRow>(
          `/compras_cotizacion_lineas?project_id=${eq(projectId)}&select=id,cotizacion_id,requisicion_linea_id,cantidad,precio_unitario,descuento_pct,iva_pct&order=cotizacion_id.asc`
        ),
      ]);
      const porCot = new Map<string, LineaCotizacion[]>();
      for (const l of lineas) {
        porCot.set(l.cotizacion_id, [
          ...(porCot.get(l.cotizacion_id) ?? []),
          { id: l.id, requisicionLineaId: l.requisicion_linea_id, cantidad: Number(l.cantidad), precioUnitario: Number(l.precio_unitario), descuentoPct: Number(l.descuento_pct), ivaPct: Number(l.iva_pct) },
        ]);
      }
      return cots.map((c) => cotizacionDeFila(c, porCot.get(c.id) ?? []));
    },

    guardarCotizacion: (projectId, actor, id, c) =>
      rpc<number>("compras_guardar_cotizacion", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_datos: {
          requisicion_id: c.requisicionId,
          proveedor_id: c.proveedorId,
          referencia: c.referencia,
          fecha: c.fecha,
          vigencia_hasta: c.vigenciaHasta,
          plazo_entrega_dias: c.plazoEntregaDias,
          dias_pago: c.diasPago,
          anticipo_pct: c.anticipoPct,
          forma_pago: c.formaPago,
          observaciones: c.observaciones,
        },
        p_lineas: c.lineas.map((l) => ({
          id: l.id,
          requisicion_linea_id: l.requisicionLineaId,
          cantidad: l.cantidad,
          precio_unitario: l.precioUnitario,
          descuento_pct: l.descuentoPct,
          iva_pct: l.ivaPct,
        })),
        p_version: c.version,
      }),

    anularCotizacion: (projectId, actor, id, motivo, version) =>
      rpc<number>("compras_anular_cotizacion", { p_project_id: projectId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_id: id, p_motivo: motivo, p_version: version }),

    async listComparativos(projectId) {
      const rows = await all<ComparativoRow>(
        `/compras_comparativos?project_id=${eq(projectId)}&select=requisicion_id,estado,criterios,cotizacion_elegida_id,justificacion,motivo,propuesto,propuesto_por_id,propuesto_por,aprobado,aprobado_por,version&order=requisicion_id.asc`
      );
      return rows.map(comparativoDeFila);
    },

    accionComparativo: (projectId, actor, requisicionId, a, requiere) =>
      rpc<number>("compras_accion_comparativo", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_requisicion_id: requisicionId,
        p_accion: a.accion,
        p_criterios: a.criterios,
        p_elegida: a.cotizacionElegidaId,
        p_justificacion: a.justificacion,
        p_motivo: a.motivo,
        p_requiere_justificacion: requiere,
        p_version: a.version,
      }),

    async listOrdenes(projectId) {
      const [ords, lineas] = await Promise.all([
        all<OrdenRow>(
          `/compras_ordenes?project_id=${eq(projectId)}&select=id,tipo,numero,requisicion_id,cotizacion_id,proveedor_id,estado,revision,elaborado_por_id,elaborado_por,fecha_entrega,lugar_entrega,forma_pago,dias_pago,anticipo_pct,retencion_garantia_pct,objeto,polizas,observaciones,motivo,enviada,aprobada,aprobada_por,version,creada,actualizado,actualizado_por&order=creada.desc`
        ),
        all<OrdenLineaRow>(
          `/compras_orden_lineas?project_id=${eq(projectId)}&select=id,orden_id,requisicion_linea_id,insumo_id,codigo,descripcion,unidad,tipo,cantidad,precio_unitario,descuento_pct,iva_pct&order=orden_id.asc`
        ),
      ]);
      const porOrden = new Map<string, LineaOrden[]>();
      for (const l of lineas) porOrden.set(l.orden_id, [...(porOrden.get(l.orden_id) ?? []), lineaOrdenDeFila(l)]);
      return ords.map((o) => ordenDeFila(o, porOrden.get(o.id) ?? []));
    },

    async listRevisiones(projectId) {
      const rows = await all<{ orden_id: string; revision: number; creada: string; por: string; motivo: string; anterior: Record<string, unknown> }>(
        `/compras_orden_revisiones?project_id=${eq(projectId)}&select=orden_id,revision,creada,por,motivo,anterior&order=orden_id.asc,revision.asc`
      );
      return rows.map((r) => revisionDeFila(r));
    },

    guardarOrden: (projectId, actor, id, c) =>
      rpc<number>("compras_guardar_orden", {
        p_project_id: projectId,
        p_actor_id: actor.id,
        p_actor_nombre: actor.nombre,
        p_id: id,
        p_datos: {
          tipo: c.tipo,
          requisicion_id: c.requisicionId,
          fecha_entrega: c.fechaEntrega,
          lugar_entrega: c.lugarEntrega,
          forma_pago: c.formaPago,
          dias_pago: c.diasPago,
          anticipo_pct: c.anticipoPct,
          retencion_garantia_pct: c.retencionGarantiaPct,
          objeto: c.objeto,
          polizas: c.polizas,
          observaciones: c.observaciones,
        },
        p_lineas: c.lineas.map((l) => ({
          requisicion_linea_id: l.requisicionLineaId,
          cantidad: l.cantidad,
          precio_unitario: l.precioUnitario,
          descuento_pct: l.descuentoPct,
          iva_pct: l.ivaPct,
        })),
        p_version: c.version,
      }),

    accionOrden: (projectId, actor, id, a) =>
      rpc<number>("compras_accion_orden", { p_project_id: projectId, p_actor_id: actor.id, p_actor_nombre: actor.nombre, p_id: id, p_accion: a.accion, p_motivo: a.motivo, p_version: a.version }),

    async listCarpetasCde(projectId) {
      const rows = await all<{ clave: string; nombre: string; folder_id: string; ruta: string; creada: string; creada_por: string }>(
        `/compras_cde_carpetas?project_id=${eq(projectId)}&select=clave,nombre,folder_id,ruta,creada,creada_por&order=clave.asc`
      );
      return rows.map((r) => ({ clave: r.clave, nombre: r.nombre, folderId: r.folder_id, ruta: r.ruta, creada: r.creada, creadaPor: r.creada_por }));
    },

    async guardarCarpetaCde(projectId, c) {
      await call("/compras_cde_carpetas?on_conflict=project_id,clave", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ project_id: projectId, clave: c.clave, nombre: c.nombre, folder_id: c.folderId, ruta: c.ruta, creada_por: c.creadaPor }),
      });
    },

    async getTiposDocumento(projectId) {
      const rows = await json<{ tipos_documento: TipoDocumentoLegal[] | null; version: number }[]>(`/compras_config?project_id=${eq(projectId)}&select=tipos_documento,version`);
      return rows[0] ? { tipos: Array.isArray(rows[0].tipos_documento) ? rows[0].tipos_documento : null, version: rows[0].version } : { tipos: null, version: 0 };
    },

    async guardarTiposDocumento(projectId, actor, tipos, version) {
      if (version === 0) {
        await call("/compras_config", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ project_id: projectId, tipos_documento: tipos, version: 1, actualizado_por: actor.nombre }),
        });
        return 1;
      }
      const rows = await json<{ version: number }[]>(`/compras_config?project_id=${eq(projectId)}&version=eq.${version}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ tipos_documento: tipos, version: version + 1, actualizado: new Date().toISOString(), actualizado_por: actor.nombre }),
      });
      if (!rows.length) throw rechazo("version-conflict");
      return rows[0].version;
    },

    async listDocumentos(projectId, f) {
      const q = [`project_id=${eq(projectId)}`];
      if (f.entidadTipo) q.push(`entidad_tipo=${eq(f.entidadTipo)}`);
      if (f.entidadId) q.push(`entidad_id=${eq(f.entidadId)}`);
      if (f.id) q.push(`id=${eq(f.id)}`);
      const rows = await all<DocumentoRow>(`/compras_documentos?${q.join("&")}&select=${COLUMNAS_DOCUMENTO}&order=creado.desc`);
      return rows.map(documentoDeFila);
    },

    async crearDocumento(projectId, d) {
      await call("/compras_documentos", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...filaDeDocumento(d), project_id: projectId, id: d.id }) });
    },

    async actualizarDocumento(projectId, id, cambios, version, actor) {
      const fila = filaDeDocumento(cambios);
      const rows = await json<DocumentoRow[]>(`/compras_documentos?project_id=${eq(projectId)}&id=${eq(id)}&version=eq.${version}&select=${COLUMNAS_DOCUMENTO}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...fila, version: version + 1, actualizado: new Date().toISOString(), actualizado_por: actor.nombre }),
      });
      return rows[0] ? documentoDeFila(rows[0]) : null;
    },

    async registrarSync(projectId, e) {
      await call("/compras_sync_historial", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ project_id: projectId, documento_id: e.documentoId, por: e.por, accion: e.accion, resultado: e.resultado, detalle: e.detalle.slice(0, 1000) }),
      });
    },

    async listSync(projectId, documentoId) {
      const rows = await all<{ documento_id: string; creado: string; por: string; accion: string; resultado: SyncEntrada["resultado"]; detalle: string }>(
        `/compras_sync_historial?project_id=${eq(projectId)}&documento_id=${eq(documentoId)}&select=documento_id,creado,por,accion,resultado,detalle&order=id.asc`
      );
      return rows.map((r) => ({ documentoId: r.documento_id, creado: r.creado, por: r.por, accion: r.accion, resultado: r.resultado, detalle: r.detalle }));
    },

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

const CONFIG_INICIAL: ConfigCompras = { toleranciaPct: 0, minCotizaciones: 3, version: 0 };

interface ProveedorRow {
  id: string;
  nit: string;
  dv: number;
  tipo_persona: Proveedor["tipoPersona"];
  razon_social: string;
  nombre_comercial: string;
  contacto: string;
  telefono: string;
  correo: string;
  ciudad: string;
  direccion: string;
  categorias: Proveedor["categorias"] | null;
  responsable_iva: boolean;
  observaciones: string;
  estado: EstadoProveedor;
  motivo_estado: string;
  version: number;
  creado: string;
  creado_por: string;
  actualizado: string | null;
  actualizado_por: string | null;
}

function proveedorDeFila(r: ProveedorRow): Proveedor {
  return {
    id: r.id,
    nit: r.nit,
    dv: Number(r.dv),
    tipoPersona: r.tipo_persona,
    razonSocial: r.razon_social,
    nombreComercial: r.nombre_comercial,
    contacto: r.contacto,
    telefono: r.telefono,
    correo: r.correo,
    ciudad: r.ciudad,
    direccion: r.direccion,
    categorias: r.categorias ?? [],
    responsableIva: r.responsable_iva,
    observaciones: r.observaciones,
    estado: r.estado,
    motivoEstado: r.motivo_estado,
    version: r.version,
    creado: r.creado,
    creadoPor: r.creado_por,
    actualizado: r.actualizado,
    actualizadoPor: r.actualizado_por,
  };
}

interface CotizacionRow {
  id: string;
  numero: number;
  requisicion_id: string;
  proveedor_id: string;
  referencia: string;
  fecha: string;
  vigencia_hasta: string;
  plazo_entrega_dias: number;
  dias_pago: number;
  anticipo_pct: number | string;
  forma_pago: string;
  observaciones: string;
  estado: Cotizacion["estado"];
  motivo: string;
  version: number;
  creada: string;
  creada_por: string;
  actualizado: string | null;
  actualizado_por: string | null;
}

interface CotizacionLineaRow {
  id: string;
  cotizacion_id: string;
  requisicion_linea_id: string;
  cantidad: number | string;
  precio_unitario: number | string;
  descuento_pct: number | string;
  iva_pct: number | string;
}

function cotizacionDeFila(c: CotizacionRow, lineas: LineaCotizacion[]): Cotizacion {
  return {
    id: c.id,
    numero: c.numero,
    requisicionId: c.requisicion_id,
    proveedorId: c.proveedor_id,
    referencia: c.referencia,
    fecha: c.fecha,
    vigenciaHasta: c.vigencia_hasta,
    plazoEntregaDias: c.plazo_entrega_dias,
    diasPago: c.dias_pago,
    anticipoPct: Number(c.anticipo_pct),
    formaPago: c.forma_pago,
    observaciones: c.observaciones,
    estado: c.estado,
    motivo: c.motivo,
    lineas,
    version: c.version,
    creada: c.creada,
    creadaPor: c.creada_por,
    actualizado: c.actualizado,
    actualizadoPor: c.actualizado_por,
  };
}

interface ComparativoRow {
  requisicion_id: string;
  estado: Comparativo["estado"];
  criterios: Criterios | null;
  cotizacion_elegida_id: string | null;
  justificacion: string;
  motivo: string;
  propuesto: string | null;
  propuesto_por_id: string | null;
  propuesto_por: string | null;
  aprobado: string | null;
  aprobado_por: string | null;
  version: number;
}

function comparativoDeFila(r: ComparativoRow): Comparativo {
  return {
    requisicionId: r.requisicion_id,
    estado: r.estado,
    criterios: r.criterios ?? { ...CRITERIOS_INICIALES },
    cotizacionElegidaId: r.cotizacion_elegida_id,
    justificacion: r.justificacion,
    motivo: r.motivo,
    propuesto: r.propuesto,
    propuestoPorId: r.propuesto_por_id,
    propuestoPor: r.propuesto_por,
    aprobado: r.aprobado,
    aprobadoPor: r.aprobado_por,
    version: r.version,
  };
}

const COLUMNAS_DOCUMENTO =
  "id,entidad_tipo,entidad_id,tipo_doc,titulo,nombre_original,nombre_archivo,carpeta_id,ruta,tamano,sha256,origen,vence,estado,upload_id,file_id,version_id,revision,intentos,ultimo_error,subido_por_id,subido_por,creado,confirmado,motivo_anulacion,version";

interface DocumentoRow {
  id: string;
  entidad_tipo: Documento["entidadTipo"];
  entidad_id: string;
  tipo_doc: string;
  titulo: string;
  nombre_original: string;
  nombre_archivo: string;
  carpeta_id: string;
  ruta: string;
  tamano: number | string;
  sha256: string;
  origen: Documento["origen"];
  vence: string | null;
  estado: Documento["estado"];
  upload_id: string | null;
  file_id: string | null;
  version_id: string | null;
  revision: number | null;
  intentos: number;
  ultimo_error: string;
  subido_por_id: string;
  subido_por: string;
  creado: string;
  confirmado: string | null;
  motivo_anulacion: string;
  version: number;
}

function documentoDeFila(r: DocumentoRow): Documento {
  return {
    id: r.id,
    entidadTipo: r.entidad_tipo,
    entidadId: r.entidad_id,
    tipoDoc: r.tipo_doc,
    titulo: r.titulo,
    nombreOriginal: r.nombre_original,
    nombreArchivo: r.nombre_archivo,
    carpetaId: r.carpeta_id,
    ruta: r.ruta,
    tamano: Number(r.tamano),
    sha256: r.sha256,
    origen: r.origen,
    vence: r.vence,
    estado: r.estado,
    uploadId: r.upload_id,
    fileId: r.file_id,
    versionId: r.version_id,
    revision: r.revision,
    intentos: r.intentos,
    ultimoError: r.ultimo_error,
    subidoPorId: r.subido_por_id,
    subidoPor: r.subido_por,
    creado: r.creado,
    confirmado: r.confirmado,
    motivoAnulacion: r.motivo_anulacion,
    version: r.version,
  };
}

/** Only the fields given, with the database's names. */
function filaDeDocumento(d: Partial<Documento>): Record<string, unknown> {
  const mapa: Record<string, string> = {
    entidadTipo: "entidad_tipo", entidadId: "entidad_id", tipoDoc: "tipo_doc", titulo: "titulo", nombreOriginal: "nombre_original", nombreArchivo: "nombre_archivo",
    carpetaId: "carpeta_id", ruta: "ruta", tamano: "tamano", sha256: "sha256", origen: "origen", vence: "vence", estado: "estado", uploadId: "upload_id", fileId: "file_id",
    versionId: "version_id", revision: "revision", intentos: "intentos", ultimoError: "ultimo_error", subidoPorId: "subido_por_id", subidoPor: "subido_por",
    confirmado: "confirmado", motivoAnulacion: "motivo_anulacion",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (mapa[k] && v !== undefined) out[mapa[k]] = v;
  return out;
}

interface OrdenRow {
  id: string;
  tipo: Orden["tipo"];
  numero: number;
  requisicion_id: string;
  cotizacion_id: string;
  proveedor_id: string;
  estado: Orden["estado"];
  revision: number;
  elaborado_por_id: string;
  elaborado_por: string;
  fecha_entrega: string;
  lugar_entrega: string;
  forma_pago: string;
  dias_pago: number;
  anticipo_pct: number | string;
  retencion_garantia_pct: number | string;
  objeto: string;
  polizas: string;
  observaciones: string;
  motivo: string;
  enviada: string | null;
  aprobada: string | null;
  aprobada_por: string | null;
  version: number;
  creada: string;
  actualizado: string | null;
  actualizado_por: string | null;
}

interface OrdenLineaRow {
  id: string;
  orden_id: string;
  requisicion_linea_id: string;
  insumo_id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: LineaOrden["tipo"];
  cantidad: number | string;
  precio_unitario: number | string;
  descuento_pct: number | string;
  iva_pct: number | string;
}

function lineaOrdenDeFila(l: OrdenLineaRow): LineaOrden {
  return {
    id: l.id,
    requisicionLineaId: l.requisicion_linea_id,
    insumoId: l.insumo_id,
    codigo: l.codigo,
    descripcion: l.descripcion,
    unidad: l.unidad,
    tipo: l.tipo,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precio_unitario),
    descuentoPct: Number(l.descuento_pct),
    ivaPct: Number(l.iva_pct),
  };
}

function ordenDeFila(o: OrdenRow, lineas: LineaOrden[]): Orden {
  return {
    id: o.id,
    tipo: o.tipo,
    numero: o.numero,
    requisicionId: o.requisicion_id,
    cotizacionId: o.cotizacion_id,
    proveedorId: o.proveedor_id,
    estado: o.estado,
    revision: o.revision,
    elaboradoPorId: o.elaborado_por_id,
    elaboradoPor: o.elaborado_por,
    fechaEntrega: o.fecha_entrega,
    lugarEntrega: o.lugar_entrega,
    formaPago: o.forma_pago,
    diasPago: o.dias_pago,
    anticipoPct: Number(o.anticipo_pct),
    retencionGarantiaPct: Number(o.retencion_garantia_pct),
    objeto: o.objeto,
    polizas: o.polizas,
    observaciones: o.observaciones,
    motivo: o.motivo,
    enviada: o.enviada,
    aprobada: o.aprobada,
    aprobadaPor: o.aprobada_por,
    lineas,
    version: o.version,
    creada: o.creada,
    actualizado: o.actualizado,
    actualizadoPor: o.actualizado_por,
  };
}

/** A saved revision: the order as it was (from its JSON in the database). */
function revisionDeFila(r: { orden_id: string; revision: number; creada: string; por: string; motivo: string; anterior: Record<string, unknown> }): RevisionOrden {
  const a = r.anterior;
  const lineas = (Array.isArray(a.lineas) ? (a.lineas as Record<string, unknown>[]) : []).map((l, i) => ({
    id: `${r.orden_id}-r${r.revision}-${i}`,
    requisicionLineaId: String(l.requisicion_linea_id ?? ""),
    insumoId: String(l.insumo_id ?? ""),
    codigo: String(l.codigo ?? ""),
    descripcion: String(l.descripcion ?? ""),
    unidad: String(l.unidad ?? ""),
    tipo: (l.tipo ?? "MT") as LineaOrden["tipo"],
    cantidad: Number(l.cantidad ?? 0),
    precioUnitario: Number(l.precio_unitario ?? 0),
    descuentoPct: Number(l.descuento_pct ?? 0),
    ivaPct: Number(l.iva_pct ?? 0),
  }));
  return {
    ordenId: r.orden_id,
    revision: r.revision,
    creada: r.creada,
    por: r.por,
    motivo: r.motivo,
    anterior: {
      fechaEntrega: String(a.fecha_entrega ?? ""),
      lugarEntrega: String(a.lugar_entrega ?? ""),
      formaPago: String(a.forma_pago ?? ""),
      diasPago: Number(a.dias_pago ?? 0),
      anticipoPct: Number(a.anticipo_pct ?? 0),
      retencionGarantiaPct: Number(a.retencion_garantia_pct ?? 0),
      objeto: String(a.objeto ?? ""),
      polizas: String(a.polizas ?? ""),
      lineas,
      total: totalesCotizacion({ lineas }).total,
    },
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
  const proveedores = new Map<string, Proveedor & { projectId: string }>();
  const cotizaciones = new Map<string, Cotizacion & { projectId: string }>();
  const comparativos = new Map<string, Comparativo & { projectId: string }>();
  const ordenes = new Map<string, Orden & { projectId: string }>();
  const revisiones: (RevisionOrden & { projectId: string })[] = [];
  const ordsDe = (projectId: string): Orden[] => [...ordenes.values()].filter((o) => o.projectId === projectId).map(sinProyecto);
  const carpetasCde = new Map<string, CarpetaCde & { projectId: string }>();
  const tiposDoc = new Map<string, TipoDocumentoLegal[]>();
  const documentos = new Map<string, Documento & { projectId: string }>();
  const sync: (SyncEntrada & { projectId: string })[] = [];
  const siguiente = (projectId: string, tipo: string) => {
    const n = (consecutivos.get(`${projectId}|${tipo}`) ?? 0) + 1;
    consecutivos.set(`${projectId}|${tipo}`, n);
    return n;
  };
  const sinProyecto = <T extends { projectId: string }>(x: T): Omit<T, "projectId"> => {
    const { projectId: _, ...resto } = structuredClone(x);
    return resto;
  };
  const provsDe = (projectId: string): Proveedor[] => [...proveedores.values()].filter((p) => p.projectId === projectId).map(sinProyecto);
  const cotsDe = (projectId: string): Cotizacion[] => [...cotizaciones.values()].filter((c) => c.projectId === projectId).map(sinProyecto);
  const compsDe = (projectId: string): Comparativo[] => [...comparativos.values()].filter((c) => c.projectId === projectId).map(sinProyecto);
  const configDe = (projectId: string): ConfigCompras => ({ ...(configs.get(projectId) ?? CONFIG_INICIAL) });
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
      return configDe(projectId);
    },
    async guardarConfig(projectId, actor, c, version) {
      if (!tiene(permisosDe(projectId, actor.id), "accesos", "administrar")) throw rechazo("sin-permiso");
      const antes = configs.get(projectId);
      if ((antes?.version ?? 0) !== version) throw rechazo("version-conflict");
      if (!(c.toleranciaPct >= 0 && c.toleranciaPct <= 100) || !(c.minCotizaciones >= 1 && c.minCotizaciones <= 10)) throw rechazo("datos");
      configs.set(projectId, { ...c, version: version + 1 });
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: "config.cambiar", modulo: "requisiciones", objetoTipo: "proyecto", objetoId: projectId, sujetoId: null, sujetoNombre: "", resultado: "ok",
        detalle: { tolerancia_antes: antes?.toleranciaPct ?? 0, tolerancia: c.toleranciaPct, min_cotizaciones_antes: antes?.minCotizaciones ?? 3, min_cotizaciones: c.minCotizaciones },
      });
      return version + 1;
    },
    async listProveedores(projectId) {
      return provsDe(projectId).sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, "es"));
    },
    async guardarProveedor(projectId, actor, id, d, version) {
      const antes = proveedores.get(id);
      if (antes && antes.projectId !== projectId) throw rechazo("no-existe");
      if (!tiene(permisosDe(projectId, actor.id), "proveedores", antes ? "editar" : "crear")) throw rechazo("sin-permiso");
      if ((antes?.version ?? 0) !== version) throw rechazo("version-conflict");
      if (provsDe(projectId).some((p) => p.id !== id && p.nit === d.nit)) throw rechazo("nit-repetido");
      const ahoraIso = ahora();
      proveedores.set(id, {
        ...d, projectId, id, estado: antes?.estado ?? "activo", motivoEstado: antes?.motivoEstado ?? "", version: version + 1,
        creado: antes?.creado ?? ahoraIso, creadoPor: antes?.creadoPor ?? actor.nombre, actualizado: ahoraIso, actualizadoPor: actor.nombre,
      });
      auditar(projectId, { actorId: actor.id, actorNombre: actor.nombre, accion: antes ? "proveedores.editar" : "proveedores.crear", modulo: "proveedores", objetoTipo: "proveedor", objetoId: id, sujetoId: null, sujetoNombre: d.razonSocial, resultado: "ok", detalle: { nit: `${d.nit}-${d.dv}` } });
      return version + 1;
    },
    async estadoProveedor(projectId, actor, id, estado, motivo, version) {
      if (!tiene(permisosDe(projectId, actor.id), "proveedores", "anular")) throw rechazo("sin-permiso");
      const p = proveedores.get(id);
      if (!p || p.projectId !== projectId) throw rechazo("no-existe");
      if (estado !== "activo" && !motivo.trim()) throw rechazo("motivo-requerido");
      if (p.version !== version) throw rechazo("version-conflict");
      const de = p.estado;
      Object.assign(p, { estado, motivoEstado: estado === "activo" ? "" : motivo.trim(), version: version + 1, actualizado: ahora(), actualizadoPor: actor.nombre });
      auditar(projectId, { actorId: actor.id, actorNombre: actor.nombre, accion: "proveedores.estado", modulo: "proveedores", objetoTipo: "proveedor", objetoId: id, sujetoId: null, sujetoNombre: p.razonSocial, resultado: "ok", detalle: { de, a: estado, motivo: motivo.trim() } });
      return version + 1;
    },
    async listCotizaciones(projectId) {
      return cotsDe(projectId).sort((a, b) => b.numero - a.numero);
    },
    async guardarCotizacion(projectId, actor, id, c) {
      const antes = cotizaciones.get(id);
      if (antes && antes.projectId !== projectId) throw rechazo("no-existe");
      const reqs = reqsDe(projectId);
      const ctx = { actorId: actor.id, permisos: permisosDe(projectId, actor.id), hoy: hoy(), minCotizaciones: configDe(projectId).minCotizaciones };
      const motivo = revisarCotizacion(
        ctx, c, antes ? sinProyecto(antes) : null, reqs.find((r) => r.id === c.requisicionId), compsDe(projectId).find((x) => x.requisicionId === c.requisicionId),
        provsDe(projectId).find((p) => p.id === c.proveedorId), cotsDe(projectId)
      );
      if (motivo) throw rechazo(motivo);
      const numero = antes?.numero ?? siguiente(projectId, "cotizacion");
      const ahoraIso = ahora();
      cotizaciones.set(id, {
        ...c, projectId, id, numero, estado: "registrada", motivo: "", version: c.version + 1,
        creada: antes?.creada ?? ahoraIso, creadaPor: antes?.creadaPor ?? actor.nombre, actualizado: ahoraIso, actualizadoPor: actor.nombre,
      });
      const req = reqs.find((r) => r.id === c.requisicionId)!;
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: antes ? "cotizaciones.editar" : "cotizaciones.registrar", modulo: "cotizaciones", objetoTipo: "cotizacion", objetoId: id,
        sujetoId: null, sujetoNombre: numeroCotizacion(numero), resultado: "ok",
        detalle: { requisicion: numeroRequisicion(req.numero), proveedor: proveedores.get(c.proveedorId)?.razonSocial ?? "", lineas: c.lineas.length },
      });
      return c.version + 1;
    },
    async anularCotizacion(projectId, actor, id, motivo, version) {
      if (!tiene(permisosDe(projectId, actor.id), "cotizaciones", "anular")) throw rechazo("sin-permiso");
      const c = cotizaciones.get(id);
      if (!c || c.projectId !== projectId) throw rechazo("no-existe");
      if (c.estado !== "registrada") throw rechazo("estado-no-valido");
      const comp = comparativos.get(c.requisicionId);
      if (comp && comp.estado !== "borrador") throw rechazo("comparativo-cerrado");
      if (!motivo.trim()) throw rechazo("motivo-requerido");
      if (c.version !== version) throw rechazo("version-conflict");
      Object.assign(c, { estado: "anulada", motivo: motivo.trim(), version: version + 1, actualizado: ahora(), actualizadoPor: actor.nombre });
      if (comp?.cotizacionElegidaId === id) comp.cotizacionElegidaId = null;
      auditar(projectId, { actorId: actor.id, actorNombre: actor.nombre, accion: "cotizaciones.anular", modulo: "cotizaciones", objetoTipo: "cotizacion", objetoId: id, sujetoId: null, sujetoNombre: numeroCotizacion(c.numero), resultado: "ok", detalle: { motivo: motivo.trim() } });
      return version + 1;
    },
    async listComparativos(projectId) {
      return compsDe(projectId);
    },
    async accionComparativo(projectId, actor, requisicionId, a, requiere) {
      const r = reqsDe(projectId).find((x) => x.id === requisicionId);
      if (!r) throw rechazo("no-existe");
      const actual = comparativos.get(requisicionId);
      const config = configDe(projectId);
      const evaluaciones = evaluar(cotsDe(projectId), r, new Map(provsDe(projectId).map((p) => [p.id, p])), a.criterios, hoy());
      const ctx = { actorId: actor.id, permisos: permisosDe(projectId, actor.id), hoy: hoy(), minCotizaciones: config.minCotizaciones };
      const motivo = revisarComparativo(ctx, r, actual ? sinProyecto(actual) : undefined, evaluaciones, a);
      if (motivo) throw rechazo(motivo);
      const elegibles = evaluaciones.filter((e) => e.elegible).length;
      if (a.accion === "proponer" && (requiere || elegibles < config.minCotizaciones) && !a.justificacion.trim()) throw rechazo("justificacion-requerida");
      const ahoraIso = ahora();
      const c: Comparativo & { projectId: string } = actual ?? {
        projectId, requisicionId, estado: "borrador", criterios: a.criterios, cotizacionElegidaId: null, justificacion: "", motivo: "",
        propuesto: null, propuestoPorId: null, propuestoPor: null, aprobado: null, aprobadoPor: null, version: 0,
      };
      const propuestoPorId = c.propuestoPorId;
      if (a.accion === "guardar" || a.accion === "proponer") Object.assign(c, { criterios: a.criterios, cotizacionElegidaId: a.cotizacionElegidaId, justificacion: a.justificacion.trim() });
      if (a.accion === "proponer") Object.assign(c, { estado: "propuesto", propuesto: ahoraIso, propuestoPorId: actor.id, propuestoPor: actor.nombre, motivo: "" });
      if (a.accion === "aprobar") Object.assign(c, { estado: "aprobado", aprobado: ahoraIso, aprobadoPor: actor.nombre, motivo: a.motivo.trim() });
      if (a.accion === "devolver") Object.assign(c, { estado: "borrador", motivo: a.motivo.trim() });
      c.version += 1;
      comparativos.set(requisicionId, c);
      const elegida = cotizaciones.get(c.cotizacionElegidaId ?? "");
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: `comparativos.${a.accion}`, modulo: "cotizaciones", objetoTipo: "comparativo", objetoId: requisicionId,
        sujetoId: propuestoPorId, sujetoNombre: numeroRequisicion(r.numero), resultado: "ok",
        detalle: {
          elegida: elegida ? `${numeroCotizacion(elegida.numero)} ${proveedores.get(elegida.proveedorId)?.razonSocial ?? ""}` : null,
          justificacion: a.justificacion.trim(), motivo: a.motivo.trim(), criterios: a.criterios,
        },
      });
      return c.version;
    },
    async listOrdenes(projectId) {
      return ordsDe(projectId).sort((a, b) => b.creada.localeCompare(a.creada));
    },
    async listRevisiones(projectId) {
      return revisiones.filter((r) => r.projectId === projectId).map(sinProyecto);
    },
    async guardarOrden(projectId, actor, id, c) {
      const antes = ordenes.get(id);
      if (antes && antes.projectId !== projectId) throw rechazo("no-existe");
      const r = reqsDe(projectId).find((x) => x.id === c.requisicionId);
      const comp = compsDe(projectId).find((x) => x.requisicionId === c.requisicionId);
      const cot = cotsDe(projectId).find((x) => x.id === comp?.cotizacionElegidaId);
      const motivo = revisarOrden({ actorId: actor.id, permisos: permisosDe(projectId, actor.id), hoy: hoy() }, c, antes ? sinProyecto(antes) : null, r, comp, cot, ordsDe(projectId));
      if (motivo) throw rechazo(motivo);
      const revision = antes?.revision ?? 0;
      const lineas: LineaOrden[] = c.lineas.map((l) => {
        const rl = r!.lineas.find((x) => x.id === l.requisicionLineaId)!;
        const cl = cot!.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId)!;
        if (revision === 0 && (l.precioUnitario !== cl.precioUnitario || l.descuentoPct !== cl.descuentoPct || l.ivaPct !== cl.ivaPct)) throw rechazo("datos");
        return { id: globalThis.crypto.randomUUID(), requisicionLineaId: rl.id, insumoId: rl.insumoId, codigo: rl.codigo, descripcion: rl.descripcion, unidad: rl.unidad, tipo: rl.tipo, cantidad: l.cantidad, precioUnitario: l.precioUnitario, descuentoPct: l.descuentoPct, ivaPct: l.ivaPct };
      });
      const numero = antes?.numero ?? siguiente(projectId, c.tipo);
      const ahoraIso = ahora();
      const { lineas: _, version: __, id: ___, ...datos } = c;
      ordenes.set(id, {
        ...(antes ?? { estado: "borrador", revision: 0, elaboradoPorId: actor.id, elaboradoPor: actor.nombre, motivo: "", enviada: null, aprobada: null, aprobadaPor: null, creada: ahoraIso }),
        ...datos, projectId, id, numero, cotizacionId: cot!.id, proveedorId: cot!.proveedorId, lineas, version: c.version + 1, actualizado: ahoraIso, actualizadoPor: actor.nombre,
      } as Orden & { projectId: string });
      const m = TIPO_ORDEN[c.tipo].modulo;
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: `${m}.${antes ? "editar" : "crear"}`, modulo: m, objetoTipo: c.tipo, objetoId: id, sujetoId: null, sujetoNombre: numeroOrden(c.tipo, numero), resultado: "ok",
        detalle: { requisicion: numeroRequisicion(r!.numero), lineas: lineas.length, revision },
      });
      return c.version + 1;
    },
    async accionOrden(projectId, actor, id, a) {
      const o = ordenes.get(id);
      if (!o || o.projectId !== projectId) throw rechazo("no-existe");
      const motivo = revisarAccionOrden({ actorId: actor.id, permisos: permisosDe(projectId, actor.id), hoy: hoy() }, sinProyecto(o), a);
      if (motivo) throw rechazo(motivo);
      const de = o.estado;
      const revisionAntes = o.revision;
      const elaboradoAntes = o.elaboradoPorId;
      const ahoraIso = ahora();
      if (a.accion === "enviar") Object.assign(o, { enviada: ahoraIso, motivo: "" });
      if (a.accion === "aprobar") Object.assign(o, { aprobada: ahoraIso, aprobadaPor: actor.nombre, motivo: a.motivo.trim() });
      if (a.accion === "devolver" || a.accion === "anular") o.motivo = a.motivo.trim();
      if (a.accion === "modificar") {
        revisiones.push({
          projectId, ordenId: id, revision: o.revision, creada: ahoraIso, por: actor.nombre, motivo: a.motivo.trim(),
          anterior: {
            fechaEntrega: o.fechaEntrega, lugarEntrega: o.lugarEntrega, formaPago: o.formaPago, diasPago: o.diasPago, anticipoPct: o.anticipoPct,
            retencionGarantiaPct: o.retencionGarantiaPct, objeto: o.objeto, polizas: o.polizas, lineas: structuredClone(o.lineas), total: totalesCotizacion(o).total,
          },
        });
        Object.assign(o, { revision: o.revision + 1, elaboradoPorId: actor.id, elaboradoPor: actor.nombre, motivo: a.motivo.trim(), enviada: null, aprobada: null, aprobadaPor: null });
      }
      o.estado = TRANSICIONES_ORDEN[a.accion].hacia;
      o.version += 1;
      Object.assign(o, { actualizado: ahoraIso, actualizadoPor: actor.nombre });
      const m = TIPO_ORDEN[o.tipo].modulo;
      auditar(projectId, {
        actorId: actor.id, actorNombre: actor.nombre, accion: `${m}.${a.accion}`, modulo: m, objetoTipo: o.tipo, objetoId: id, sujetoId: elaboradoAntes, sujetoNombre: numeroOrden(o.tipo, o.numero), resultado: "ok",
        detalle: { de, revision: revisionAntes, motivo: a.motivo.trim() },
      });
      return o.version;
    },
    async listCarpetasCde(projectId) {
      return [...carpetasCde.values()].filter((c) => c.projectId === projectId).map(sinProyecto);
    },
    async guardarCarpetaCde(projectId, c) {
      carpetasCde.set(`${projectId}|${c.clave}`, { ...c, projectId, creada: c.creada || ahora() });
    },
    async getTiposDocumento(projectId) {
      return { tipos: tiposDoc.has(projectId) ? structuredClone(tiposDoc.get(projectId)!) : null, version: configDe(projectId).version };
    },
    async guardarTiposDocumento(projectId, actor, tipos, version) {
      const c = configDe(projectId);
      if (c.version !== version) throw rechazo("version-conflict");
      configs.set(projectId, { ...c, version: version + 1 });
      tiposDoc.set(projectId, structuredClone(tipos));
      void actor;
      return version + 1;
    },
    async listDocumentos(projectId, f) {
      return [...documentos.values()]
        .filter((d) => d.projectId === projectId && (!f.entidadTipo || d.entidadTipo === f.entidadTipo) && (!f.entidadId || d.entidadId === f.entidadId) && (!f.id || d.id === f.id))
        .sort((a, b) => b.creado.localeCompare(a.creado))
        .map(sinProyecto);
    },
    async crearDocumento(projectId, d) {
      const choca = [...documentos.values()].some((x) => x.projectId === projectId && x.estado !== "anulado" && x.carpetaId === d.carpetaId && x.nombreArchivo.toLowerCase() === d.nombreArchivo.toLowerCase());
      if (choca) throw rechazo("documento-duplicado");
      documentos.set(d.id, { ...structuredClone(d), projectId });
    },
    async actualizarDocumento(projectId, id, cambios, version, actor) {
      const d = documentos.get(id);
      if (!d || d.projectId !== projectId || d.version !== version) return null;
      // The same rules as the database: confirmed before backed up; a backed-up one only goes to cancelled; a cancelled one doesn't change.
      const nuevo = { ...d, ...cambios };
      if (d.estado === "anulado") throw rechazo("estado-no-valido");
      if (d.estado === "respaldado" && (!["respaldado", "anulado"].includes(nuevo.estado) || nuevo.fileId !== d.fileId || nuevo.versionId !== d.versionId)) throw rechazo("estado-no-valido");
      if (nuevo.estado === "respaldado" && (!nuevo.fileId || !nuevo.versionId || !nuevo.confirmado)) throw rechazo("datos");
      if (nuevo.estado === "anulado" && !nuevo.motivoAnulacion.trim()) throw rechazo("datos");
      Object.assign(d, cambios, { version: version + 1 });
      void actor;
      return sinProyecto(d);
    },
    async registrarSync(projectId, e) {
      sync.push({ ...e, projectId, creado: e.creado || ahora() });
    },
    async listSync(projectId, documentoId) {
      return sync.filter((e) => e.projectId === projectId && e.documentoId === documentoId).map(sinProyecto);
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
      if (!numero) numero = siguiente(projectId, "requisicion");
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
      if (a.accion === "anular" && ordsDe(projectId).some((o) => o.requisicionId === id && o.estado !== "anulada")) throw rechazo("con-ordenes");
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
