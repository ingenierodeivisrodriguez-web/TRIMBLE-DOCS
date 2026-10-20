import { diasEntre, DIAS_AVISO, esFecha } from "../manuales/licencia";
import { EstadoLicencia, GRUPOS_LICENCIA, GrupoLicencia, Licencia, Modulo, MODULOS_BASE, NuevaLicencia, Permiso } from "./types";

/**
 * Licenses of the companies: the newest row of a company's history is the one
 * in force. Dates are ISO "YYYY-MM-DD" (shown as DD-MM-AAAA), "today" is
 * Colombia's day, and `hasta` is the last day with access.
 */

/** The license in force: the newest event (rows are only added, never changed). */
export function licenciaVigente(historial: Licencia[]): Licencia | null {
  let ultima: Licencia | null = null;
  for (const l of historial) if (!ultima || l.creado > ultima.creado || (l.creado === ultima.creado && l.id > ultima.id)) ultima = l;
  return ultima;
}

/** The state of a company's license on `hoy`. */
export function estadoLicencia(l: Licencia | null, empresaActiva: boolean, hoy: string): { estado: EstadoLicencia; diasRestantes: number | null } {
  if (!empresaActiva) return { estado: "empresa-inactiva", diasRestantes: null };
  if (!l) return { estado: "sin-licencia", diasRestantes: null };
  const dias = l.hasta ? diasEntre(hoy, l.hasta) : null;
  if (l.suspendida) return { estado: "suspendida", diasRestantes: dias };
  if (l.desde > hoy) return { estado: "programada", diasRestantes: dias };
  if (dias === null) return { estado: "sin-vencimiento", diasRestantes: null };
  if (dias < 0) return { estado: "vencida", diasRestantes: dias };
  return { estado: dias <= DIAS_AVISO ? "por-vencer" : "activa", diasRestantes: dias };
}

/** People of the company work only with a license in these states. */
export function licenciaPermiteTrabajar(estado: EstadoLicencia): boolean {
  return estado === "activa" || estado === "por-vencer" || estado === "sin-vencimiento";
}

/** The modules a license enables: the base ones plus those of its groups. */
export function modulosHabilitados(grupos: readonly GrupoLicencia[]): Set<Modulo> {
  const set = new Set<Modulo>(MODULOS_BASE);
  for (const g of GRUPOS_LICENCIA) if (grupos.includes(g.id)) for (const m of g.modulos) set.add(m);
  return set;
}

/** A role's permissions cut down to what the license sells. */
export function permisosContratados(permisos: readonly Permiso[], grupos: readonly GrupoLicencia[]): Permiso[] {
  const set = modulosHabilitados(grupos);
  return permisos.filter((p) => set.has(p.split(".")[0] as Modulo));
}

export const ESTADOS_LICENCIA: Record<EstadoLicencia, { texto: string; color: string; fondo: string }> = {
  "sin-licencia": { texto: "Sin licencia", color: "#6b7684", fondo: "#eef1f4" },
  programada: { texto: "Empieza más adelante", color: "#7a5a00", fondo: "#fff4d1" },
  activa: { texto: "Activa", color: "#2e6b22", fondo: "#e3f3de" },
  "por-vencer": { texto: "Por vencer", color: "#7a5a00", fondo: "#fff4d1" },
  vencida: { texto: "Vencida", color: "#b3261e", fondo: "#fbe4e2" },
  suspendida: { texto: "Suspendida", color: "#b3261e", fondo: "#fbe4e2" },
  "sin-vencimiento": { texto: "Sin vencimiento", color: "#2e6b22", fondo: "#e3f3de" },
  "empresa-inactiva": { texto: "Empresa desactivada", color: "#b3261e", fondo: "#fbe4e2" },
};

export const EVENTOS_LICENCIA: Record<NuevaLicencia["evento"], string> = {
  activacion: "Activación",
  renovacion: "Renovación",
  cambio: "Cambio de plan o límites",
  suspension: "Suspensión",
  reactivacion: "Reactivación",
};

/** Why this license event can't be recorded, or null. */
export function revisarLicencia(l: NuevaLicencia): string | null {
  if (!esFecha(l.desde)) return "La fecha de inicio no es válida.";
  if (l.hasta !== null && (!esFecha(l.hasta) || l.hasta < l.desde)) return "La fecha final no es válida o es anterior a la inicial.";
  if (!Number.isInteger(l.maxProyectos) || l.maxProyectos < 1 || l.maxProyectos > 10_000) return "El número de proyectos debe ser un entero entre 1 y 10.000.";
  if (!Number.isInteger(l.maxUsuarios) || l.maxUsuarios < 1 || l.maxUsuarios > 100_000) return "El número de personas debe ser un entero entre 1 y 100.000.";
  if (!l.plan.trim() || l.plan.length > 80) return "Escribe el nombre del plan (hasta 80 caracteres).";
  if (l.soporte.length > 300) return "El soporte contratado admite hasta 300 caracteres.";
  if (l.suspendida !== (l.evento === "suspension")) return "Solo el evento Suspensión deja la licencia suspendida.";
  if ((l.evento === "suspension" || l.evento === "reactivacion") && !l.motivo.trim()) return "Escribe el motivo de la suspensión o la reactivación.";
  if (l.motivo.length > 1000) return "El motivo admite hasta 1.000 caracteres.";
  return null;
}
