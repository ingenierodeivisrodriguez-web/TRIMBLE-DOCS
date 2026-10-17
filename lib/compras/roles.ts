import { ACCIONES_POR_MODULO, Modulo, MODULOS, Permiso, PERMISOS_VALIDOS, ROL_ADMIN } from "./types";

/** A role as created when Compras is turned on in a project. */
export interface RolInicial {
  clave: string;
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
}

/** "requisiciones: ver crear" -> the listed permissions of that module. */
function de(modulo: Modulo, ...acciones: string[]): Permiso[] {
  return acciones.map((a) => `${modulo}.${a}` as Permiso);
}

const VER_TODO: Permiso[] = MODULOS.map((m) => `${m.id}.ver` as Permiso);

/**
 * The initial roles of every project. Each project can change their matrix
 * afterwards (except the administrator's, which always has everything).
 */
export const ROLES_INICIALES: RolInicial[] = [
  {
    clave: ROL_ADMIN,
    nombre: "Administrador de plataforma",
    descripcion: "Todo, incluido dar y revocar accesos. Su matriz no se puede cambiar.",
    permisos: PERMISOS_VALIDOS,
  },
  {
    clave: "director",
    nombre: "Director",
    descripcion: "Ve todo y aprueba requisiciones (también sobre el presupuesto), comparativos, órdenes, contratos y recepciones.",
    permisos: [
      ...VER_TODO,
      ...de("requisiciones", "aprobar", "exceder", "anular", "documentos"),
      ...de("cotizaciones", "aprobar", "documentos"),
      ...de("ordenes", "aprobar", "anular", "documentos"),
      ...de("contratos", "aprobar", "anular", "documentos"),
      ...de("recepciones", "aprobar", "documentos"),
      ...de("proveedores", "documentos"),
    ],
  },
  {
    clave: "residente",
    nombre: "Residente",
    descripcion: "Pide insumos (requisiciones) y registra lo que llega a la obra.",
    permisos: [
      ...de("insumos", "ver"),
      ...de("requisiciones", "ver", "crear", "editar", "anular", "documentos"),
      ...de("proveedores", "ver"),
      ...de("cotizaciones", "ver"),
      ...de("ordenes", "ver"),
      ...de("contratos", "ver"),
      ...de("recepciones", "ver", "crear", "editar", "documentos"),
      ...de("documentos", "ver"),
      ...de("panel", "ver"),
    ],
  },
  {
    clave: "compras",
    nombre: "Compras",
    descripcion: "Registra proveedores, pide cotizaciones, arma comparativos y emite órdenes.",
    permisos: [
      ...de("insumos", "ver"),
      ...de("requisiciones", "ver", "documentos"),
      ...de("proveedores", "ver", "crear", "editar", "anular", "documentos"),
      ...de("cotizaciones", "ver", "crear", "editar", "anular", "documentos"),
      ...de("ordenes", "ver", "crear", "editar", "anular", "documentos"),
      ...de("contratos", "ver"),
      ...de("recepciones", "ver"),
      ...de("documentos", "ver"),
      ...de("panel", "ver"),
    ],
  },
  {
    clave: "presupuesto_costos",
    nombre: "Presupuesto y costos",
    descripcion: "Revisa que lo pedido quepa en el presupuesto y aprueba requisiciones.",
    permisos: [
      ...de("insumos", "ver"),
      ...de("requisiciones", "ver", "aprobar"),
      ...de("cotizaciones", "ver"),
      ...de("ordenes", "ver"),
      ...de("contratos", "ver"),
      ...de("recepciones", "ver"),
      ...de("panel", "ver"),
    ],
  },
  {
    clave: "juridica",
    nombre: "Jurídica",
    descripcion: "Revisa la documentación legal de los proveedores y elabora los contratos.",
    permisos: [
      ...de("proveedores", "ver", "editar", "documentos"),
      ...de("cotizaciones", "ver"),
      ...de("ordenes", "ver"),
      ...de("contratos", "ver", "crear", "editar", "anular", "documentos"),
      ...de("documentos", "ver"),
      ...de("panel", "ver"),
    ],
  },
  {
    clave: "almacen",
    nombre: "Almacén",
    descripcion: "Recibe en obra: lo recibido, aceptado, rechazado o devuelto, con su acta.",
    permisos: [
      ...de("insumos", "ver"),
      ...de("ordenes", "ver"),
      ...de("recepciones", "ver", "crear", "editar", "aprobar", "anular", "documentos"),
      ...de("documentos", "ver"),
    ],
  },
  {
    clave: "finanzas",
    nombre: "Finanzas",
    descripcion: "Aprueba órdenes y contratos desde lo financiero y revisa pagos y soportes.",
    permisos: [
      ...de("proveedores", "ver", "documentos"),
      ...de("cotizaciones", "ver"),
      ...de("ordenes", "ver", "aprobar", "documentos"),
      ...de("contratos", "ver", "aprobar", "documentos"),
      ...de("recepciones", "ver"),
      ...de("documentos", "ver"),
      ...de("panel", "ver"),
    ],
  },
  {
    clave: "auditor",
    nombre: "Auditor",
    descripcion: "Consulta todo, incluida la auditoría, sin cambiar nada.",
    permisos: VER_TODO,
  },
];

/** Keeps only valid permissions, without repeats, in matrix order. */
export function ordenarPermisos(permisos: Iterable<string>): Permiso[] {
  const set = new Set(permisos);
  return PERMISOS_VALIDOS.filter((p) => set.has(p));
}

export function esPermisoValido(p: string): p is Permiso {
  const [modulo, accion] = p.split(".");
  return (ACCIONES_POR_MODULO as Record<string, string[]>)[modulo]?.includes(accion) ?? false;
}
