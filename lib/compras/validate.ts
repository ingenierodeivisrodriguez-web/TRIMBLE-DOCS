import { isValidIsoDate } from "../propiedades/values";
import { ServiceError } from "../propiedades/service";
import { esPermisoValido } from "./roles";
import {
  AccionRequisicion,
  AccionSobreRequisicion,
  CambioAsignacion,
  CambioRequisicion,
  CambioRol,
  ConfigCompras,
  FiltroAuditoria,
  MAX_AUDITORIA,
  MAX_LINEAS_REQUISICION,
  MODULOS,
  Permiso,
  Prioridad,
} from "./types";

/** Checks everything that comes from the browser before the rules see it. */

function bad(message: string): never {
  throw new ServiceError(message, 400, "datos");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,100}$/;

function texto(value: unknown, what: string, max: number): string {
  if (typeof value !== "string") bad(`${what}: se esperaba un texto.`);
  if (value.length > max) bad(`${what}: máximo ${max} caracteres.`);
  return value;
}

function fecha(value: unknown, what: string): string {
  if (typeof value !== "string" || !isValidIsoDate(value)) bad(`${what}: fecha no válida.`);
  return value;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) bad("Falta la versión de lo que se está editando.");
  return value;
}

export function leerCambioAsignacion(body: unknown): CambioAsignacion {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.userId !== "string" || !USER_ID_RE.test(o.userId)) bad("Persona no válida.");
  if (typeof o.rolId !== "string" || !UUID_RE.test(o.rolId)) bad("Rol no válido.");
  const desde = fecha(o.desde, "Desde");
  const hasta = o.hasta === null || o.hasta === undefined || o.hasta === "" ? null : fecha(o.hasta, "Hasta");
  if (hasta !== null && hasta < desde) bad("La fecha final no puede ser anterior a la inicial.");
  if (typeof o.activo !== "boolean") bad("Falta indicar si el acceso queda activo.");
  return { userId: o.userId, rolId: o.rolId, desde, hasta, activo: o.activo, version: version(o.version) };
}

export function leerCambioRol(body: unknown): CambioRol {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) bad("Rol no válido.");
  const nombre = texto(o.nombre, "Nombre", 80).trim();
  if (!nombre) bad("El rol necesita un nombre.");
  const descripcion = o.descripcion === undefined ? "" : texto(o.descripcion, "Descripción", 300).trim();
  if (!Array.isArray(o.permisos)) bad("Los permisos deben ser una lista.");
  for (const p of o.permisos) if (typeof p !== "string" || !esPermisoValido(p)) bad(`Permiso no válido: "${String(p)}".`);
  if (typeof o.activo !== "boolean") bad("Falta indicar si el rol queda activo.");
  return {
    ...(o.id ? { id: o.id as string } : {}),
    nombre,
    descripcion,
    permisos: [...new Set(o.permisos as Permiso[])],
    activo: o.activo,
    version: version(o.version),
  };
}

/** The audit filters, from the query string. */
export function leerFiltroAuditoria(params: URLSearchParams): FiltroAuditoria {
  const f: FiltroAuditoria = {};
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (desde) f.desde = fecha(desde, "Desde");
  if (hasta) f.hasta = fecha(hasta, "Hasta");
  const actor = params.get("actor");
  if (actor) {
    if (!USER_ID_RE.test(actor)) bad("Persona no válida.");
    f.actorId = actor;
  }
  const modulo = params.get("modulo");
  if (modulo) {
    if (!MODULOS.some((m) => m.id === modulo)) bad("Módulo no válido.");
    f.modulo = modulo;
  }
  const resultado = params.get("resultado");
  if (resultado) {
    if (resultado !== "ok" && resultado !== "denegado" && resultado !== "error") bad("Resultado no válido.");
    f.resultado = resultado;
  }
  const antes = params.get("antesDe");
  if (antes) {
    const n = Number(antes);
    if (!Number.isInteger(n) || n < 1) bad("Posición no válida.");
    f.antesDe = n;
  }
  const limite = params.get("limite");
  if (limite) {
    const n = Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > MAX_AUDITORIA) bad(`Máximo ${MAX_AUDITORIA} filas por consulta.`);
    f.limite = n;
  }
  return f;
}

// ---------------------------------------------------------------- requisitions

const PRIORIDAD_RE = /^(baja|normal|alta|urgente)$/;
const ITEM_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cantidad(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) bad(`${what}: cantidad no válida.`);
  return Math.round(value * 10_000) / 10_000;
}

export function leerCambioRequisicion(body: unknown): CambioRequisicion {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) bad("Requisición no válida.");
  const fechaRequerida = fecha(o.fechaRequerida, "Fecha requerida");
  if (typeof o.prioridad !== "string" || !PRIORIDAD_RE.test(o.prioridad)) bad("Prioridad no válida.");
  const justificacion = texto(o.justificacion ?? "", "Justificación", 1000).trim();
  if (!Array.isArray(o.lineas)) bad("Las líneas deben ser una lista.");
  if (o.lineas.length > MAX_LINEAS_REQUISICION) bad(`Máximo ${MAX_LINEAS_REQUISICION} líneas por requisición.`);
  const lineas = o.lineas.map((v, i) => {
    const l = (v ?? {}) as Record<string, unknown>;
    if (typeof l.insumoId !== "string" || !ITEM_RE.test(l.insumoId)) bad(`Línea ${i + 1}: insumo no válido.`);
    const partida = l.partidaItemId === null || l.partidaItemId === undefined || l.partidaItemId === "" ? null : l.partidaItemId;
    if (partida !== null && (typeof partida !== "string" || !ITEM_RE.test(partida))) bad(`Línea ${i + 1}: partida no válida.`);
    const c = cantidad(l.cantidad, `Línea ${i + 1}`);
    if (c <= 0) bad(`Línea ${i + 1}: la cantidad debe ser mayor que cero.`);
    return { insumoId: l.insumoId, partidaItemId: partida as string | null, cantidad: c, justificacionExceso: texto(l.justificacionExceso ?? "", `Línea ${i + 1}: justificación del exceso`, 500).trim() };
  });
  return { ...(o.id ? { id: o.id as string } : {}), fechaRequerida, prioridad: o.prioridad as Prioridad, justificacion, lineas, version: version(o.version) };
}

const ACCION_RE = /^(enviar|aprobar|rechazar|devolver|anular)$/;

export function leerAccionRequisicion(body: unknown): AccionSobreRequisicion {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.accion !== "string" || !ACCION_RE.test(o.accion)) bad("Acción no válida.");
  const motivo = texto(o.motivo ?? "", "Motivo", 1000).trim();
  let aprobadas: Record<string, number> | undefined;
  if (o.aprobadas !== undefined && o.aprobadas !== null) {
    if (typeof o.aprobadas !== "object" || Array.isArray(o.aprobadas)) bad("Cantidades aprobadas no válidas.");
    aprobadas = {};
    for (const [k, v] of Object.entries(o.aprobadas as Record<string, unknown>)) {
      if (!UUID_RE.test(k)) bad("Línea no válida.");
      aprobadas[k] = cantidad(v, "Cantidad aprobada");
    }
  }
  return { accion: o.accion as AccionRequisicion, motivo, ...(aprobadas ? { aprobadas } : {}), version: version(o.version) };
}

export function leerConfig(body: unknown): ConfigCompras {
  const o = (body ?? {}) as Record<string, unknown>;
  const t = o.toleranciaPct;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 100) bad("La tolerancia debe estar entre 0 y 100 %.");
  return { toleranciaPct: Math.round(t * 100) / 100, version: version(o.version) };
}
