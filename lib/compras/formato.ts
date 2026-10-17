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
  "requisiciones.consultar": "Consultar requisiciones",
  "requisiciones.guardar": "Guardar una requisición",
  "requisiciones.crear": "Crear requisición",
  "requisiciones.editar": "Editar requisición",
  "requisiciones.enviar": "Enviar requisición",
  "requisiciones.aprobar": "Aprobar requisición",
  "requisiciones.rechazar": "Rechazar requisición",
  "requisiciones.devolver": "Devolver requisición",
  "requisiciones.anular": "Anular requisición",
  "config.cambiar": "Cambiar la configuración",
  "proveedores.consultar": "Consultar proveedores",
  "proveedores.guardar": "Guardar un proveedor",
  "proveedores.crear": "Crear proveedor",
  "proveedores.editar": "Editar proveedor",
  "proveedores.estado": "Cambiar estado del proveedor",
  "cotizaciones.consultar": "Consultar cotizaciones",
  "cotizaciones.guardar": "Guardar una cotización",
  "cotizaciones.registrar": "Registrar cotización",
  "cotizaciones.editar": "Corregir cotización",
  "cotizaciones.anular": "Anular cotización",
  "comparativos.guardar": "Guardar comparativo",
  "comparativos.proponer": "Proponer proveedor",
  "comparativos.aprobar": "Aprobar proveedor elegido",
  "comparativos.devolver": "Devolver comparativo",
  "ordenes.consultar": "Consultar órdenes",
  "ordenes.guardar": "Guardar una orden",
  "ordenes.crear": "Crear orden de compra",
  "ordenes.editar": "Editar orden de compra",
  "ordenes.enviar": "Enviar orden a aprobación",
  "ordenes.aprobar": "Aprobar y emitir orden",
  "ordenes.devolver": "Devolver orden",
  "ordenes.anular": "Anular orden",
  "ordenes.modificar": "Modificar orden emitida",
  "contratos.guardar": "Guardar un contrato",
  "contratos.crear": "Crear contrato",
  "contratos.editar": "Editar contrato",
  "contratos.enviar": "Enviar contrato a aprobación",
  "contratos.aprobar": "Aprobar y emitir contrato",
  "contratos.devolver": "Devolver contrato",
  "contratos.anular": "Anular contrato",
  "contratos.modificar": "Modificar contrato (otrosí)",
  "cde.prueba": "Prueba de escritura en el CDE",
  "cde.carpetas": "Preparar carpetas en el CDE",
  "documentos.consultar": "Consultar documentos",
  "documentos.cargar": "Cargar documento al CDE",
  "documentos.respaldado": "Documento respaldado en el CDE",
  "documentos.abrir": "Abrir documento",
  "documentos.anular": "Anular documento",
  "documentos.tipos": "Cambiar los documentos legales de proveedores",
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

const ESTADO_ORDEN_TEXTO: Record<string, string> = { borrador: "Desde borrador", enviada: "Desde por aprobar", aprobada: "Desde emitida", anulada: "Desde anulada" };
const ESTADO_PROVEEDOR: Record<string, string> = { activo: "Activo", inactivo: "Inactivo", bloqueado: "Bloqueado" };
const ESTADO_TEXTO: Record<string, string> = { borrador: "Borrador", enviada: "Por aprobar", aprobada: "Aprobada", rechazada: "Rechazada", anulada: "Anulada" };

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
    if (!motivo && typeof d.mensaje === "string") return `${String(d.paso ?? "")}: ${d.mensaje}`;
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
  if (e.accion === "config.cambiar") {
    const partes = [`Tolerancia ${String(d.tolerancia_antes ?? 0)} % → ${String(d.tolerancia ?? 0)} %`];
    if (d.min_cotizaciones !== undefined && d.min_cotizaciones !== d.min_cotizaciones_antes) partes.push(`mínimo de cotizaciones ${String(d.min_cotizaciones_antes ?? 3)} → ${String(d.min_cotizaciones)}`);
    return partes.join("; ");
  }
  if (e.accion === "proveedores.crear" || e.accion === "proveedores.editar") return `NIT ${String(d.nit ?? "")}`;
  if (e.accion === "proveedores.estado") return `${ESTADO_PROVEEDOR[String(d.de)] ?? String(d.de)} → ${ESTADO_PROVEEDOR[String(d.a)] ?? String(d.a)}${d.motivo ? `. motivo: ${String(d.motivo)}` : ""}`;
  if (e.accion === "cotizaciones.registrar" || e.accion === "cotizaciones.editar") return `${String(d.requisicion ?? "")}, ${String(d.proveedor ?? "")}, ${String(d.lineas ?? 0)} línea(s)`;
  if (e.accion === "cotizaciones.anular") return `motivo: ${String(d.motivo ?? "")}`;
  if (/^(ordenes|contratos).(crear|editar)$/.test(e.accion)) return `${String(d.requisicion ?? "")}, ${String(d.lineas ?? 0)} línea(s)${Number(d.revision) ? `, revisión ${String(d.revision)}` : ""}`;
  if (/^(ordenes|contratos)./.test(e.accion)) {
    const partes = [`${ESTADO_ORDEN_TEXTO[String(d.de)] ?? String(d.de ?? "")}${Number(d.revision) ? ` (revisión ${String(d.revision)})` : ""}`];
    if (d.motivo) partes.push(`motivo: ${String(d.motivo)}`);
    return partes.join(". ");
  }
  if (e.accion === "cde.prueba") return `${String(d.paso ?? "")}: ${String(d.mensaje ?? d.motivo ?? "")}`;
  if (e.accion === "cde.carpetas") {
    const creadas = Array.isArray(d.creadas) ? (d.creadas as string[]) : [];
    return creadas.length ? `Creó: ${creadas.join("; ")}` : "Ya existían todas; solo se registraron";
  }
  if (e.accion === "documentos.cargar") return `${String(d.ruta ?? "")} / ${String(d.documento ?? "")}`;
  if (e.accion === "documentos.respaldado") return `${String(d.ruta ?? "")}, revisión ${String(d.revision ?? "")} en Trimble`;
  if (e.accion === "documentos.anular") return `motivo: ${String(d.motivo ?? "")}`;
  if (e.accion === "documentos.tipos") return Array.isArray(d.tipos) ? (d.tipos as string[]).join("; ") : "";
  if (e.accion.startsWith("comparativos.")) {
    const partes: string[] = [];
    if (d.elegida) partes.push(`elegida: ${String(d.elegida)}`);
    if (d.justificacion) partes.push(`justificación: ${String(d.justificacion)}`);
    if (d.motivo) partes.push(`motivo: ${String(d.motivo)}`);
    return partes.join(". ");
  }
  if (e.accion === "requisiciones.crear" || e.accion === "requisiciones.editar") {
    return `${String(d.lineas ?? 0)} insumo(s)${typeof d.fecha_requerida === "string" ? `, requerida el ${fecha(d.fecha_requerida)}` : ""}`;
  }
  if (e.accion.startsWith("requisiciones.") && typeof d.a === "string") {
    const partes = [`${ESTADO_TEXTO[String(d.de)] ?? String(d.de)} → ${ESTADO_TEXTO[d.a] ?? d.a}`];
    const aprobadas = d.aprobadas && typeof d.aprobadas === "object" ? Object.entries(d.aprobadas as Record<string, unknown>) : [];
    if (aprobadas.length) partes.push(`aprobado: ${aprobadas.map(([k, v]) => `${k} ${Number(v)}`).join("; ")}`);
    if (typeof d.motivo === "string" && d.motivo) partes.push(`motivo: ${d.motivo}`);
    return partes.join(". ");
  }
  return "";
}
