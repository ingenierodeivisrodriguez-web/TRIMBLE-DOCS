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

export type Accion = "ver" | "crear" | "editar" | "aprobar" | "anular" | "documentos" | "administrar";

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
  requisiciones: OPERACION,
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
}

export interface InsumosResponse {
  /** The budget read (null: the project has no saved budget). */
  presupuesto: { version: number; actualizado: string | null; actualizadoPor: string | null } | null;
  insumos: InsumoPlanificado[];
  /** Resources given as a percentage ("%MO", "%"): money, not quantities; they aren't bought. */
  porcentaje: { id: string; descripcion: string; monto: number }[];
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
