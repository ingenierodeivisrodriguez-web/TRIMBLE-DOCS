// Shared by the API and the "Compras y Contratación" screen (project menu).
import type { TipoInsumo } from "../presupuesto/types";

// ---------------------------------------------------------------- permissions matrix

/** The parts of the tool a permission refers to (all of them, including later phases). */
export type Modulo =
  | "accesos"
  | "auditoria"
  | "insumos"
  | "requisiciones"
  | "proveedores"
  | "cotizaciones"
  | "ordenes"
  | "contratos"
  | "documentos"
  | "recepciones"
  | "panel";

export type Accion = "ver" | "crear" | "editar" | "aprobar" | "exceder" | "anular" | "documentos" | "administrar";

/** "modulo.accion", e.g. "requisiciones.aprobar". */
export type Permiso = `${Modulo}.${Accion}`;

export const MODULOS: { id: Modulo; nombre: string; ayuda: string }[] = [
  { id: "accesos", nombre: "Accesos y roles", ayuda: "Quién entra a Compras en este proyecto y qué puede hacer." },
  { id: "auditoria", nombre: "Auditoría", ayuda: "El registro de todo lo que se hizo (y lo que se intentó sin permiso)." },
  { id: "insumos", nombre: "Insumos del presupuesto", ayuda: "Los insumos planificados en Presupuesto y su estado de abastecimiento." },
  { id: "requisiciones", nombre: "Requisiciones", ayuda: "Pedidos de obra de insumos del presupuesto." },
  { id: "proveedores", nombre: "Proveedores", ayuda: "Registro de proveedores y su documentación legal." },
  { id: "cotizaciones", nombre: "Cotizaciones y comparativos", ayuda: "Ofertas de los proveedores y la elección justificada." },
  { id: "ordenes", nombre: "Órdenes de compra", ayuda: "Órdenes emitidas a partir de requisiciones aprobadas." },
  { id: "contratos", nombre: "Contratos", ayuda: "Contratos y sus modificaciones (otrosíes)." },
  { id: "documentos", nombre: "Documentos (CDE)", ayuda: "Carpetas de Trimble Connect, cola de cargas pendientes y tipos de documento." },
  { id: "recepciones", nombre: "Recepción en obra", ayuda: "Entregas recibidas, aceptadas, rechazadas o devueltas." },
  { id: "panel", nombre: "Panel y trazabilidad", ayuda: "Indicadores y la ruta de cada insumo." },
];

export const ACCIONES: { id: Accion; nombre: string; ayuda: string }[] = [
  { id: "ver", nombre: "Ver", ayuda: "Consultar." },
  { id: "crear", nombre: "Crear", ayuda: "Registrar nuevos." },
  { id: "editar", nombre: "Editar", ayuda: "Modificar lo registrado mientras su estado lo permita." },
  { id: "aprobar", nombre: "Aprobar / rechazar", ayuda: "Decidir sobre lo enviado." },
  { id: "exceder", nombre: "Aprobar sobre el presupuesto", ayuda: "Requisiciones: aprobar cantidades que pasan lo planificado (más la tolerancia)." },
  { id: "anular", nombre: "Anular", ayuda: "Dejar sin efecto (nunca se borra)." },
  { id: "documentos", nombre: "Cargar / descargar documentos", ayuda: "Subir soportes al CDE del proyecto y abrirlos." },
  { id: "administrar", nombre: "Administrar", ayuda: "Accesos: dar, cambiar y revocar accesos y roles. Documentos: preparar carpetas y tipos de documento." },
];

const OPERACION: Accion[] = ["ver", "crear", "editar", "aprobar", "anular", "documentos"];

/** Which actions make sense in each module; the matrix only offers these. */
export const ACCIONES_POR_MODULO: Record<Modulo, Accion[]> = {
  accesos: ["ver", "administrar"],
  auditoria: ["ver"],
  insumos: ["ver"],
  requisiciones: ["ver", "crear", "editar", "aprobar", "exceder", "anular", "documentos"],
  proveedores: ["ver", "crear", "editar", "anular", "documentos"],
  cotizaciones: OPERACION,
  ordenes: OPERACION,
  contratos: OPERACION,
  documentos: ["ver", "administrar"],
  recepciones: OPERACION,
  panel: ["ver"],
};

/** Every valid permission, in matrix order (the SQL check lists the same ones). */
export const PERMISOS_VALIDOS: Permiso[] = MODULOS.flatMap((m) => ACCIONES_POR_MODULO[m.id].map((a) => `${m.id}.${a}` as Permiso));

// ---------------------------------------------------------------- roles and people

/** The role nobody can edit: it always has every permission, so a project can't lock itself out. */
export const ROL_ADMIN = "admin_plataforma";

export interface Rol {
  id: string;
  /** Stable key: the initial roles keep theirs ("director"...); the ones created later get "personal_…". */
  clave: string;
  nombre: string;
  descripcion: string;
  /** One of the initial roles (can't be deactivated). */
  sistema: boolean;
  activo: boolean;
  permisos: Permiso[];
  version: number;
  actualizado: string | null;
  actualizadoPor: string | null;
}

/** A person's access to Compras in a project: one role, valid between two dates (hasta null: no end). */
export interface Asignacion {
  userId: string;
  nombre: string;
  email: string;
  rolId: string;
  /** YYYY-MM-DD */
  desde: string;
  hasta: string | null;
  /** False: revoked. */
  activo: boolean;
  version: number;
  otorgadoPor: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export type EstadoAsignacion = "vigente" | "programada" | "vencida" | "revocada";

/** What the screen sends to give, change or revoke an access. */
export interface CambioAsignacion {
  userId: string;
  rolId: string;
  desde: string;
  hasta: string | null;
  activo: boolean;
  /** 0 for a person without an access yet. */
  version: number;
}

/** What the screen sends to create or change a role. */
export interface CambioRol {
  /** Absent: a new role. */
  id?: string;
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
  activo: boolean;
  version: number;
}

// ---------------------------------------------------------------- audit

export type ResultadoAuditoria = "ok" | "denegado" | "error";

export interface EntradaAuditoria {
  id: number;
  creado: string;
  actorId: string;
  actorNombre: string;
  /** What was done, e.g. "accesos.asignar", "roles.guardar", "ingreso". */
  accion: string;
  modulo: string;
  objetoTipo: string;
  objetoId: string;
  /** To whom (a person whose access changed), when it applies. */
  sujetoId: string | null;
  sujetoNombre: string;
  resultado: ResultadoAuditoria;
  detalle: Record<string, unknown>;
}

export interface FiltroAuditoria {
  /** YYYY-MM-DD, both included (Colombian time). */
  desde?: string;
  hasta?: string;
  actorId?: string;
  modulo?: string;
  resultado?: ResultadoAuditoria;
  /** Entries older than this id (for "Ver más"). */
  antesDe?: number;
  limite?: number;
}

export const MAX_AUDITORIA = 200;

// ---------------------------------------------------------------- planned resources (from Presupuesto)

/** How a resource is bought: by purchase order (materials, equipment) or by contract (subcontracts, labor). */
export type ViaCompra = "orden" | "contrato";

export const VIA_COMPRA: Record<ViaCompra, string> = { orden: "Orden de compra", contrato: "Contrato" };

/** Where a planned resource is used: one partida of the budget. */
export interface UsoInsumo {
  /** The budget row's id (stable while the partida exists). */
  itemId: string;
  subpresupuesto: string;
  /** "1.2.3" */
  numero: string;
  descripcion: string;
  unidad: string;
  /** The partida's effective quantity (typed, or from the model). */
  metrado: number;
  desdeModelo: boolean;
  /** How much of the resource this partida needs (going into subpartidas). */
  cantidad: number;
}

export interface InsumoPlanificado {
  /** The key in the budget's resources (the catalog resource's id). */
  id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  /** Unit price in the budget. */
  precio: number;
  /** Planned quantity: the same as Presupuesto's "Lista de insumos" (all its subpresupuestos). */
  cantidad: number;
  monto: number;
  via: ViaCompra;
  usos: UsoInsumo[];
  /** Asked in requisitions sent or approved (the approved quantity once approved). */
  solicitado: number;
  /** Approved in requisitions. */
  aprobado: number;
  /** In approved purchase orders and contracts. */
  comprometido: number;
  /** Accepted on site, in approved receptions. */
  recibido: number;
}

export interface InsumosResponse {
  /** The budget read (null: the project has no saved budget). */
  presupuesto: { version: number; actualizado: string | null; actualizadoPor: string | null } | null;
  insumos: InsumoPlanificado[];
  /** Resources given as a percentage ("%MO", "%"): money, not quantities; they aren't bought. */
  porcentaje: { id: string; descripcion: string; monto: number }[];
}

// ---------------------------------------------------------------- requisitions

export type EstadoRequisicion = "borrador" | "enviada" | "aprobada" | "rechazada" | "anulada";
export type Prioridad = "baja" | "normal" | "alta" | "urgente";
/** What can be done to a requisition besides editing its draft. */
export type AccionRequisicion = "enviar" | "aprobar" | "rechazar" | "devolver" | "anular";

export const PRIORIDADES: { id: Prioridad; nombre: string }[] = [
  { id: "baja", nombre: "Baja" },
  { id: "normal", nombre: "Normal" },
  { id: "alta", nombre: "Alta" },
  { id: "urgente", nombre: "Urgente" },
];

/** A line: a planned resource (with a copy of its data when it was saved), how much is asked and how much was approved. */
export interface LineaRequisicion {
  id: string;
  insumoId: string;
  /** The budget partida it is for, when given (the limit is still per resource, for the whole project). */
  partidaItemId: string | null;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  /** Planned unit price in the budget. */
  precio: number;
  cantidad: number;
  /** Set when approved (0 to the line's quantity). */
  cantidadAprobada: number | null;
  /** Planned quantity of the resource when the requisition was sent. */
  planificado: number | null;
  /** Why it asks for more than the budget allows (required then). */
  justificacionExceso: string;
}

export interface Requisicion {
  id: string;
  /** Consecutive per project: REQ-0001. */
  numero: number;
  estado: EstadoRequisicion;
  solicitanteId: string;
  solicitanteNombre: string;
  /** YYYY-MM-DD */
  fechaRequerida: string;
  prioridad: Prioridad;
  justificacion: string;
  /** Reason of the last decision (returned, rejected, cancelled) or the approver's note. */
  motivo: string;
  /** The budget version the requisition was sent against. */
  presupuestoVersion: number | null;
  enviada: string | null;
  enviadaPor: string | null;
  decidida: string | null;
  decididaPor: string | null;
  lineas: LineaRequisicion[];
  version: number;
  creada: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

/** A draft as the screen sends it (the server fills in each resource's data from the budget). */
export interface CambioRequisicion {
  id?: string;
  fechaRequerida: string;
  prioridad: Prioridad;
  justificacion: string;
  lineas: { insumoId: string; partidaItemId: string | null; cantidad: number; justificacionExceso: string }[];
  version: number;
}

export interface AccionSobreRequisicion {
  accion: AccionRequisicion;
  /** Required to return, reject or cancel. */
  motivo: string;
  /** Approved quantity by line id (approving; a missing line gets its whole quantity). */
  aprobadas?: Record<string, number>;
  version: number;
}

export interface ConfigCompras {
  /** How much over the planned quantity can be asked without a justification, in %. */
  toleranciaPct: number;
  /** Quotations expected per requisition; with fewer, the choice must be justified. */
  minCotizaciones: number;
  version: number;
}

// ---------------------------------------------------------------- suppliers

export type EstadoProveedor = "activo" | "inactivo" | "bloqueado";
export type TipoPersona = "natural" | "juridica";

export interface DatosProveedor {
  /** Digits only, without the check digit. */
  nit: string;
  tipoPersona: TipoPersona;
  razonSocial: string;
  nombreComercial: string;
  contacto: string;
  telefono: string;
  correo: string;
  ciudad: string;
  direccion: string;
  /** Kinds of resources it supplies (MT, EQ, SC, MO). */
  categorias: TipoInsumo[];
  /** Charges IVA (responsable de IVA). */
  responsableIva: boolean;
  observaciones: string;
}

export interface Proveedor extends DatosProveedor {
  id: string;
  /** DIAN check digit of the NIT. */
  dv: number;
  estado: EstadoProveedor;
  /** Why it was deactivated or blocked. */
  motivoEstado: string;
  version: number;
  creado: string;
  creadoPor: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export interface CambioProveedor extends DatosProveedor {
  id?: string;
  version: number;
}

export interface CambioEstadoProveedor {
  estado: EstadoProveedor;
  motivo: string;
  version: number;
}

// ---------------------------------------------------------------- quotations and comparison

export type EstadoCotizacion = "registrada" | "anulada";

export interface LineaCotizacion {
  id: string;
  /** The requisition line it prices. */
  requisicionLineaId: string;
  cantidad: number;
  /** Before discount and IVA. */
  precioUnitario: number;
  descuentoPct: number;
  ivaPct: number;
}

export interface Cotizacion {
  id: string;
  /** COT-0001 */
  numero: number;
  requisicionId: string;
  proveedorId: string;
  /** The supplier's own number for it. */
  referencia: string;
  /** YYYY-MM-DD */
  fecha: string;
  vigenciaHasta: string;
  plazoEntregaDias: number;
  /** Days of credit (0: cash). */
  diasPago: number;
  anticipoPct: number;
  formaPago: string;
  observaciones: string;
  estado: EstadoCotizacion;
  motivo: string;
  lineas: LineaCotizacion[];
  version: number;
  creada: string;
  creadaPor: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export interface CambioCotizacion {
  id?: string;
  requisicionId: string;
  proveedorId: string;
  referencia: string;
  fecha: string;
  vigenciaHasta: string;
  plazoEntregaDias: number;
  diasPago: number;
  anticipoPct: number;
  formaPago: string;
  observaciones: string;
  lineas: Omit<LineaCotizacion, "id">[];
  version: number;
}

/** Weights (summing 100) of each criterion in the comparison. */
export interface Criterios {
  precio: number;
  entrega: number;
  pago: number;
}

export const CRITERIOS_INICIALES: Criterios = { precio: 70, entrega: 20, pago: 10 };

export type EstadoComparativo = "borrador" | "propuesto" | "aprobado";
export type AccionComparativo = "guardar" | "proponer" | "aprobar" | "devolver";

/** The comparison of a requisition's quotations and the chosen one. */
export interface Comparativo {
  requisicionId: string;
  estado: EstadoComparativo;
  criterios: Criterios;
  cotizacionElegidaId: string | null;
  justificacion: string;
  /** Why it was returned. */
  motivo: string;
  propuesto: string | null;
  propuestoPorId: string | null;
  propuestoPor: string | null;
  aprobado: string | null;
  aprobadoPor: string | null;
  version: number;
}

export interface AccionSobreComparativo {
  accion: AccionComparativo;
  criterios: Criterios;
  cotizacionElegidaId: string | null;
  justificacion: string;
  motivo: string;
  /** 0 when the requisition has no comparison saved yet. */
  version: number;
}

export interface CotizacionesResponse {
  /** Approved requisitions (what can be quoted). */
  requisiciones: Requisicion[];
  cotizaciones: Cotizacion[];
  comparativos: Comparativo[];
  proveedores: Proveedor[];
  config: ConfigCompras;
  hoy: string;
}

// ---------------------------------------------------------------- purchase orders and contracts

export type TipoOrden = "orden" | "contrato";
export type EstadoOrden = "borrador" | "enviada" | "aprobada" | "anulada";
export type AccionOrden = "enviar" | "aprobar" | "devolver" | "anular" | "modificar";

export const TIPO_ORDEN: Record<TipoOrden, { nombre: string; prefijo: string; modulo: Modulo }> = {
  orden: { nombre: "Orden de compra", prefijo: "OC", modulo: "ordenes" },
  contrato: { nombre: "Contrato", prefijo: "CT", modulo: "contratos" },
};

export interface LineaOrden {
  id: string;
  requisicionLineaId: string;
  /** Copy of the resource as in the requisition. */
  insumoId: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  ivaPct: number;
}

export interface DatosOrden {
  /** YYYY-MM-DD: delivery (orders) or end (contracts). */
  fechaEntrega: string;
  lugarEntrega: string;
  formaPago: string;
  diasPago: number;
  anticipoPct: number;
  /** Contracts: retention kept until the work is received. */
  retencionGarantiaPct: number;
  /** Contracts: what is contracted (required to send). */
  objeto: string;
  /** Contracts: required insurance policies. */
  polizas: string;
  observaciones: string;
}

export interface Orden extends DatosOrden {
  id: string;
  tipo: TipoOrden;
  /** OC-0001 / CT-0001, per type. */
  numero: number;
  requisicionId: string;
  cotizacionId: string;
  proveedorId: string;
  estado: EstadoOrden;
  /** 0 the original; each modification of an approved one adds 1 (otrosí, in contracts). */
  revision: number;
  elaboradoPorId: string;
  elaboradoPor: string;
  /** Last reason (returned, cancelled, modified) or the approver's note. */
  motivo: string;
  enviada: string | null;
  aprobada: string | null;
  aprobadaPor: string | null;
  lineas: LineaOrden[];
  version: number;
  creada: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

/** What an approved order looked like before a modification (kept, never changed). */
export interface RevisionOrden {
  ordenId: string;
  revision: number;
  creada: string;
  por: string;
  motivo: string;
  /** The order and its lines before the change. */
  anterior: Pick<Orden, "fechaEntrega" | "lugarEntrega" | "formaPago" | "diasPago" | "anticipoPct" | "retencionGarantiaPct" | "objeto" | "polizas" | "lineas"> & {
    total: number;
  };
}

export interface CambioOrden extends DatosOrden {
  id?: string;
  tipo: TipoOrden;
  requisicionId: string;
  /** Quantity (and, in a modification, price) by requisition line; prices come from the chosen quotation. */
  lineas: { requisicionLineaId: string; cantidad: number; precioUnitario?: number; descuentoPct?: number; ivaPct?: number }[];
  version: number;
}

export interface AccionSobreOrden {
  accion: AccionOrden;
  motivo: string;
  version: number;
}

/** A chosen supplier still to order: the approved comparison of a requisition. */
export interface PorOrdenar {
  requisicion: Requisicion;
  cotizacion: Cotizacion;
  proveedor: Proveedor;
  /** What can still be ordered of each requisition line, counting every order and contract (seen or not). */
  pendientes: Record<string, number>;
}

export interface OrdenesResponse {
  ordenes: Orden[];
  revisiones: RevisionOrden[];
  /** Approved comparisons with what is left to order of each line. */
  porOrdenar: PorOrdenar[];
  proveedores: Proveedor[];
  hoy: string;
}

export interface ProveedoresResponse {
  proveedores: Proveedor[];
  /** Quotations of each supplier (history), when the caller can see quotations. */
  cotizaciones: Cotizacion[];
  hoy: string;
}

export interface RequisicionesResponse {
  requisiciones: Requisicion[];
  config: ConfigCompras;
  hoy: string;
}

export const MAX_LINEAS_REQUISICION = 200;

// ---------------------------------------------------------------- receptions on site

export type EstadoRecepcion = "borrador" | "enviada" | "aprobada" | "anulada";
export type AccionRecepcion = "enviar" | "aprobar" | "devolver" | "anular";

/** One line of a reception: what arrived of an order line, accepted plus rejected equals received. */
export interface LineaRecepcion {
  id: string;
  /** The order line, by its requisition line (stable across the order's revisions). */
  requisicionLineaId: string;
  insumoId: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  recibido: number;
  aceptado: number;
  rechazado: number;
  /** Of what was rejected, what went back to the supplier. */
  devuelto: number;
  /** Why it was rejected (required when something was). */
  motivo: string;
}

export interface Recepcion {
  id: string;
  /** REC-0001, per project. */
  numero: number;
  ordenId: string;
  estado: EstadoRecepcion;
  /** YYYY-MM-DD: when it arrived (never in the future). */
  fecha: string;
  /** The supplier's delivery note. */
  remision: string;
  observaciones: string;
  elaboradoPorId: string;
  elaboradoPor: string;
  /** Last reason (returned, cancelled) or the approver's note. */
  motivo: string;
  enviada: string | null;
  aprobada: string | null;
  aprobadaPor: string | null;
  lineas: LineaRecepcion[];
  version: number;
  creada: string;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export interface CambioRecepcion {
  id?: string;
  ordenId: string;
  fecha: string;
  remision: string;
  observaciones: string;
  /** Accepted is received less rejected. */
  lineas: { requisicionLineaId: string; recibido: number; rechazado: number; devuelto: number; motivo: string }[];
  version: number;
}

export interface AccionSobreRecepcion {
  accion: AccionRecepcion;
  motivo: string;
  version: number;
}

/** An issued order or contract as the people who receive see it (no prices). */
export interface OrdenPorRecibir {
  id: string;
  tipo: TipoOrden;
  numero: number;
  revision: number;
  estado: EstadoOrden;
  proveedor: string;
  nit: string;
  fechaEntrega: string;
  lugarEntrega: string;
  lineas: {
    requisicionLineaId: string;
    insumoId: string;
    codigo: string;
    descripcion: string;
    unidad: string;
    tipo: TipoInsumo;
    ordenado: number;
    /** Accepted in approved receptions. */
    aceptado: number;
    /** Accepted in receptions still in draft or sent. */
    enTramite: number;
    rechazado: number;
    devuelto: number;
    /** Ordered less accepted (approved or in process). */
    pendiente: number;
  }[];
}

export interface RecepcionesResponse {
  recepciones: Recepcion[];
  /** Issued orders and contracts (and those with receptions), with what is still to receive. */
  ordenes: OrdenPorRecibir[];
  hoy: string;
}

// ---------------------------------------------------------------- API responses

export interface EstadoResponse {
  projectId: string;
  user: { id: string; name: string };
  /** Is the caller an administrator of the project in Trimble Connect. */
  esAdminTrimble: boolean;
  /** Compras has been turned on in this project (it has an administrator). */
  activo: boolean;
  /** The caller's access in force, or null (no access: nothing can be done). */
  acceso: { rol: { id: string; nombre: string }; desde: string; hasta: string | null; permisos: Permiso[] } | null;
  /** The caller can turn Compras on (Trimble administrator, project without an administrator yet). */
  puedeActivar: boolean;
  /** Who to ask for access (administrators of Compras in the project). */
  administradores: string[];
}

export interface AccesosResponse {
  roles: Rol[];
  usuarios: Asignacion[];
  /** The caller's permissions, to know what they can give. */
  misPermisos: Permiso[];
  hoy: string;
}

// ---------------------------------------------------------------- CDE (Trimble Connect folders)

export type PasoPruebaCde = "inspeccionar" | "crear-carpeta" | "iniciar-subida" | "estado-subida" | "subir-desde-servidor" | "duplicado";

/** One step of the CDE write test: whether it worked, what it means, and its data. */
export interface PruebaCdeResponse {
  paso: PasoPruebaCde;
  ok: boolean;
  mensaje: string;
  datos: Record<string, unknown>;
}

// ---------------------------------------------------------------- documents in the CDE

export type EntidadDocumento = "requisicion" | "cotizacion" | "orden" | "contrato" | "proveedor" | "recepcion";
/** pendiente: registered, waiting for Trimble's confirmation; respaldado: Trimble confirmed it (has file and version ids). */
export type EstadoDocumento = "pendiente" | "respaldado" | "error" | "anulado";
export type OrigenDocumento = "cargado" | "generado";

export interface Documento {
  id: string;
  entidadTipo: EntidadDocumento;
  entidadId: string;
  /** Kind of document (a supplier's legal ones are configurable). */
  tipoDoc: string;
  titulo: string;
  nombreOriginal: string;
  /** Name in Trimble Connect (fixed, so a retry never makes another file). */
  nombreArchivo: string;
  carpetaId: string;
  /** Path shown to people: "Compras y Contrataciones / Requisiciones". */
  ruta: string;
  tamano: number;
  sha256: string;
  origen: OrigenDocumento;
  /** YYYY-MM-DD: legal documents that expire. */
  vence: string | null;
  estado: EstadoDocumento;
  uploadId: string | null;
  fileId: string | null;
  versionId: string | null;
  revision: number | null;
  intentos: number;
  ultimoError: string;
  subidoPorId: string;
  subidoPor: string;
  creado: string;
  confirmado: string | null;
  motivoAnulacion: string;
  version: number;
}

export interface CarpetaCde {
  clave: string;
  nombre: string;
  folderId: string;
  ruta: string;
  creada: string;
  creadaPor: string;
}

export interface TipoDocumentoLegal {
  clave: string;
  nombre: string;
  obligatorio: boolean;
  /** Days it is valid from its issue (null: no expiry), to suggest when it expires. */
  vigenciaDias: number | null;
  activo: boolean;
}

export interface SyncEntrada {
  documentoId: string;
  creado: string;
  por: string;
  accion: string;
  resultado: "ok" | "error";
  detalle: string;
}

export interface DocumentosResponse {
  documentos: Documento[];
  carpetas: CarpetaCde[];
  tipos: TipoDocumentoLegal[];
  /** The config version (the legal document kinds are saved with it). */
  versionConfig: number;
  hoy: string;
}

export interface NuevoDocumento {
  entidadTipo: EntidadDocumento;
  entidadId: string;
  tipoDoc: string;
  nombreOriginal: string;
  tamano: number;
  sha256: string;
  origen: OrigenDocumento;
  vence: string | null;
}

/** A document registered and its upload: the signed URL to PUT the content (null when there is nothing to send). */
export interface SubidaDocumento {
  documento: Documento;
  url: string | null;
}

export interface EstadoCarpetas {
  raiz: { id: string; permiso: string | null };
  carpetas: { clave: string; nombre: string; ruta: string; folderId: string | null; existe: boolean; guardada: boolean }[];
}
