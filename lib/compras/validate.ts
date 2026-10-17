import { isValidIsoDate } from "../propiedades/values";
import { ServiceError } from "../propiedades/service";
import { esPermisoValido } from "./roles";
import { CambioAsignacion, CambioRol, FiltroAuditoria, MAX_AUDITORIA, MODULOS, Permiso } from "./types";

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
