import { Accion, ACCIONES_POR_MODULO, Modulo, Permiso, PERMISOS_VALIDOS } from "./types";

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
 * technical quality lead (approves acceptance criteria) and the laboratory.
 * Each company can change their matrix and create others afterwards.
 */
export const ROLES_INICIALES: RolInicial[] = [
  {
    clave: "director",
    nombre: "Director de proyecto",
    descripcion: "Consulta indicadores y aprueba operaciones según sus atribuciones.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "VF", cantidades: "VFANX", avance: "VANX", costos: "VANX", criterios: "V", lotes: "V",
      ensayos: "VX", inspecciones: "VX", nc: "VANX", aceptacion: "VAN", documentos: "VD", reportes: "VX", bitacora: "V", accesos: "V",
    }),
  },
  {
    clave: "residente",
    nombre: "Residente de obra",
    descripcion: "Reporta cantidades, avance y observaciones.",
    permisos: matriz({
      panel: "V", estructura: "V", modelos: "VC", cantidades: "VCEDX", avance: "VCEDX", costos: "V", criterios: "V", lotes: "VCEND",
      ensayos: "V", inspecciones: "VCED", nc: "VCED", aceptacion: "V", documentos: "VD", reportes: "VX",
    }),
  },
  {
    clave: "costos",
    nombre: "Profesional de costos",
    descripcion: "Consulta y gestiona la información de costos autorizada.",
    permisos: matriz({ panel: "V", estructura: "V", modelos: "V", cantidades: "VX", avance: "VCEX", costos: "VCENDX", documentos: "VD", reportes: "VX" }),
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
      panel: "V", estructura: "V", modelos: "V", cantidades: "VX", avance: "VX", costos: "VX", criterios: "V", lotes: "V", ensayos: "VX",
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
];

const VALIDOS = new Set<string>(PERMISOS_VALIDOS);

export function esPermisoValido(p: unknown): p is Permiso {
  return typeof p === "string" && VALIDOS.has(p);
}

/** The roles' permissions in matrix order (as stored and shown). */
export function ordenar(permisos: Iterable<string>): Permiso[] {
  const set = new Set(permisos);
  return PERMISOS_VALIDOS.filter((p) => set.has(p));
}
