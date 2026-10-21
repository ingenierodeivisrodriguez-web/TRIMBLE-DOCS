import { Accion, ACCIONES_POR_MODULO, Modulo, Permiso, PERMISOS_VALIDOS, Rol } from "./types";

/** A role as created with a new company. */
export interface RolInicial {
  clave: string;
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
}

const LETRA: Record<string, Accion> = { V: "ver", C: "crear", E: "editar", F: "verificar", A: "aprobar", N: "anular", D: "documentos", X: "exportar", M: "administrar" };

/** "cantidades", "VFANX" -> the permissions of the matrix in docs/control-obra/diseno.md (§8). */
function de(modulo: Modulo, letras: string): Permiso[] {
  return [...letras].map((l) => {
    const accion = LETRA[l];
    if (!accion || !ACCIONES_POR_MODULO[modulo].includes(accion)) throw new Error(`Permiso no válido: ${modulo}.${l}`);
    return `${modulo}.${accion}` as Permiso;
  });
}

/** One row per role, one string per module, as in the approved matrix. */
function matriz(fila: Partial<Record<Modulo, string>>): Permiso[] {
  return Object.entries(fila).flatMap(([m, letras]) => de(m as Modulo, letras as string));
}

/**
 * The initial roles of every company (D13): those of the document plus the
 * technical quality lead (approves acceptance criteria) and the laboratory,
 * and since the actas plan, the inspection firm (or client) and the warehouse.
 * Each company can change their matrix and create others afterwards.
 */
export const ROLES_INICIALES: RolInicial[] = [
  {
    clave: "director",
    nombre: "Director de proyecto",
    descripcion: "Consulta indicadores y aprueba operaciones según sus atribuciones.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "VF", cantidades: "VFANX", avance: "VANX", actas_cliente: "VANDX", actas_sub: "VANDX", costos: "VANX", almacen: "VX", criterios: "V", lotes: "V",
      ensayos: "VX", inspecciones: "VX", nc: "VANX", aceptacion: "VAN", documentos: "VD", reportes: "VX", bitacora: "V", accesos: "V",
    }),
  },
  {
    clave: "residente",
    nombre: "Residente de obra",
    descripcion: "Reporta cantidades, avance y observaciones.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "VC", cantidades: "VCEDX", avance: "VCEDX", actas_cliente: "VCEDX", actas_sub: "VCEDX", costos: "V", almacen: "VAX", criterios: "V", lotes: "VCEND",
      ensayos: "V", inspecciones: "VCED", nc: "VCED", aceptacion: "V", documentos: "VD", reportes: "VX",
    }),
  },
  {
    clave: "costos",
    nombre: "Profesional de costos",
    descripcion: "Consulta y gestiona la información de costos autorizada.",
    permisos: matriz({ panel: "V", estructura: "V", modelos: "V", cantidades: "VX", avance: "VCEX", actas_cliente: "VX", actas_sub: "VX", costos: "VCENDX", almacen: "VX", documentos: "VD", reportes: "VX" }),
  },
  {
    clave: "inspector",
    nombre: "Inspector de calidad",
    descripcion: "Registra inspecciones, ensayos y no conformidades; verifica cantidades.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "VF", cantidades: "VFDX", avance: "VX", criterios: "V", lotes: "VCED", ensayos: "VF",
      inspecciones: "VCEFANDX", nc: "VCEDX", aceptacion: "VAN", documentos: "VD", reportes: "VX",
    }),
  },
  {
    clave: "auditor",
    nombre: "Auditor",
    descripcion: "Consulta la información y la bitácora autorizadas.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "V", cantidades: "VX", avance: "VX", actas_cliente: "VX", actas_sub: "VX", costos: "VX", almacen: "VX", criterios: "V", lotes: "V", ensayos: "VX",
      inspecciones: "VX", nc: "VX", aceptacion: "V", documentos: "V", reportes: "VX", bitacora: "VX", accesos: "V",
    }),
  },
  {
    clave: "responsable_tecnico",
    nombre: "Responsable técnico de calidad",
    descripcion: "Aprueba los criterios de aceptación y los ensayos; cierra no conformidades.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "V", cantidades: "V", avance: "V", criterios: "VCEANM", lotes: "VA", ensayos: "VANX",
      inspecciones: "VM", nc: "VCEANDX", aceptacion: "VAN", documentos: "VD", reportes: "VX",
    }),
  },
  {
    clave: "laboratorio",
    nombre: "Laboratorio",
    descripcion: "Registra muestras y resultados de ensayos.",
    permisos: matriz({ panel: "V", criterios: "V", lotes: "VCED", ensayos: "VCEDX", nc: "VC", documentos: "VD" }),
  },
  {
    clave: "interventoria",
    nombre: "Interventoría",
    descripcion: "Interventoría o cliente: consulta y aprueba en su paso las actas al cliente y el cierre de no conformidades.",
    permisos: matriz({
      panel: "V", estructura: "V", cantidades: "V", avance: "V", actas_cliente: "VAX", inspecciones: "VX", nc: "VAX", documentos: "V", reportes: "VX",
    }),
  },
  {
    clave: "almacenista",
    nombre: "Almacenista",
    descripcion: "Elabora los vales de salida de material y consulta existencias y consumos.",
    permisos: matriz({ panel: "V", estructura: "V", almacen: "VCEX", documentos: "VD" }),
  },
];

/** The modules added after the first companies were created: their permissions are offered to the initial roles, never added silently. */
export const MODULOS_NUEVOS: Modulo[] = ["actas_cliente", "actas_sub", "almacen"];

/**
 * The permissions of the new modules that an initial role would have today and
 * this company's copy lacks (to offer "add the suggested permissions"). Only
 * the new modules: what an administrator took away from the others stays so.
 */
export function permisosSugeridos(rol: Pick<Rol, "clave" | "sistema" | "permisos">): Permiso[] {
  if (!rol.sistema) return [];
  const inicial = ROLES_INICIALES.find((r) => r.clave === rol.clave);
  if (!inicial) return [];
  const tiene = new Set(rol.permisos);
  return inicial.permisos.filter((p) => MODULOS_NUEVOS.includes(p.split(".")[0] as Modulo) && !tiene.has(p));
}

const VALIDOS = new Set<string>(PERMISOS_VALIDOS);

export function esPermisoValido(p: unknown): p is Permiso {
  return typeof p === "string" && VALIDOS.has(p);
}

/** The roles' permissions in matrix order (as stored and shown). */
export function ordenar(permisos: Iterable<string>): Permiso[] {
  const set = new Set(permisos);
  return PERMISOS_VALIDOS.filter((p) => set.has(p));
}
