import { isoToDisplay } from "../propiedades/values";
import { esMotivo, MENSAJES } from "./accesos";
import { ACCIONES, EntradaAuditoria, EstadoAsignacion, MODULOS, Permiso } from "./types";

/** How dates, statuses and audit rows read on screen. */

/** "2026-10-16" -> "16-10-2026"; null -> "". */
export function fecha(iso: string | null): string {
  return iso ? isoToDisplay(iso) : "";
}

/** A moment as "16-10-2026 14:05" in Colombian time. */
export function fechaHora(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

export const ESTADO_ASIGNACION: Record<EstadoAsignacion, { texto: string; color: string; fondo: string }> = {
  vigente: { texto: "Vigente", color: "#2e6b22", fondo: "#e3f3de" },
  programada: { texto: "Desde una fecha futura", color: "#7a5a00", fondo: "#fff4d1" },
  vencida: { texto: "Vencida", color: "#6b7684", fondo: "#eef1f4" },
  revocada: { texto: "Revocada", color: "#b3261e", fondo: "#fbe4e2" },
};

const ACCIONES_AUDITORIA: Record<string, string> = {
  ingreso: "Entrar a Compras",
  "proyecto.activar": "Activar Compras en el proyecto",
  "accesos.asignar": "Dar acceso",
  "accesos.cambiar": "Cambiar acceso",
  "accesos.revocar": "Revocar acceso",
  "accesos.guardar": "Dar o cambiar un acceso",
  "accesos.consultar": "Consultar accesos",
  "accesos.contactos": "Ver el equipo del proyecto",
  "roles.crear": "Crear rol",
  "roles.cambiar": "Cambiar rol",
  "roles.guardar": "Crear o cambiar un rol",
  "auditoria.consultar": "Consultar la auditoría",
  "insumos.consultar": "Consultar los insumos del presupuesto",
};

export function nombreAccion(accion: string): string {
  return ACCIONES_AUDITORIA[accion] ?? accion;
}

/** "requisiciones.aprobar" -> "Requisiciones: Aprobar / rechazar". */
export function nombrePermiso(p: string): string {
  const [m, a] = p.split(".");
  const modulo = MODULOS.find((x) => x.id === m)?.nombre ?? m;
  const accion = ACCIONES.find((x) => x.id === a)?.nombre ?? a;
  return `${modulo}: ${accion}`;
}

type Vigencia = { rol?: unknown; desde?: unknown; hasta?: unknown; activo?: unknown };

function vigencia(v: Vigencia): string {
  const partes = [String(v.rol ?? "")];
  if (v.activo === false) partes.push("revocado");
  else {
    if (typeof v.desde === "string") partes.push(`desde ${fecha(v.desde)}`);
    partes.push(typeof v.hasta === "string" ? `hasta ${fecha(v.hasta)}` : "sin fecha final");
  }
  return partes.join(", ");
}

/** One line saying what happened in an audit row (why it was refused, what changed). */
export function detalleEntrada(e: EntradaAuditoria): string {
  const d = e.detalle ?? {};
  if (e.resultado !== "ok") {
    const motivo = typeof d.motivo === "string" ? d.motivo : "";
    if (motivo === "no-activado") return "Compras no está activado en el proyecto.";
    const texto = esMotivo(motivo) ? MENSAJES[motivo] : motivo;
    return typeof d.permiso === "string" ? `${texto} (permiso: ${nombrePermiso(d.permiso)})` : texto;
  }
  if (e.accion.startsWith("accesos.")) {
    const antes = d.antes as Vigencia | null | undefined;
    const despues = d.despues as Vigencia | undefined;
    if (!despues) return "";
    return antes ? `${vigencia(antes)} → ${vigencia(despues)}` : vigencia(despues);
  }
  if (e.accion.startsWith("roles.")) {
    const lista = (x: unknown) => (Array.isArray(x) ? (x as Permiso[]).map(nombrePermiso) : []);
    const partes: string[] = [];
    const mas = lista(d.agregados);
    const menos = lista(d.quitados);
    if (mas.length) partes.push(`Agregó ${mas.join("; ")}`);
    if (menos.length) partes.push(`Quitó ${menos.join("; ")}`);
    if (d.activo === false) partes.push("Rol desactivado");
    return partes.join(". ") || "Sin cambios de permisos";
  }
  if (e.accion === "proyecto.activar") return `Quedó como ${String(d.rol ?? "administrador")}.`;
  return "";
}
