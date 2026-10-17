import { isValidIsoDate } from "../propiedades/values";
import { ServiceError } from "../propiedades/service";
import type { TipoInsumo } from "../presupuesto/types";
import { leerNit } from "./proveedores";
import { esPermisoValido } from "./roles";
import {
  AccionOrden,
  AccionSobreOrden,
  CambioOrden,
  AccionComparativo,
  AccionSobreComparativo,
  CambioCotizacion,
  CambioEstadoProveedor,
  CambioProveedor,
  EstadoProveedor,
  TipoPersona,
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
  const m = o.minCotizaciones;
  if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 10) bad("El mínimo de cotizaciones debe ser un número entero entre 1 y 10.");
  return { toleranciaPct: Math.round(t * 100) / 100, minCotizaciones: m, version: version(o.version) };
}

// ---------------------------------------------------------------- suppliers

const TIPOS: TipoInsumo[] = ["MO", "MT", "EQ", "SC"];
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A supplier as typed; the NIT can come with dots and its check digit (which must be right). */
export function leerCambioProveedor(body: unknown): CambioProveedor & { dv: number } {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) bad("Proveedor no válido.");
  const nit = leerNit(texto(o.nit, "NIT", 30));
  if ("error" in nit) bad(nit.error);
  if (o.tipoPersona !== "natural" && o.tipoPersona !== "juridica") bad("Tipo de persona no válido.");
  const razonSocial = texto(o.razonSocial, "Razón social", 200).trim();
  if (!razonSocial) bad("Escribe la razón social (o el nombre, si es persona natural).");
  const correo = texto(o.correo ?? "", "Correo", 120).trim();
  if (correo && !CORREO_RE.test(correo)) bad("El correo no es válido.");
  if (!Array.isArray(o.categorias) || o.categorias.some((c) => !TIPOS.includes(c as TipoInsumo))) bad("Categorías no válidas.");
  if (typeof o.responsableIva !== "boolean") bad("Indica si es responsable de IVA.");
  return {
    ...(o.id ? { id: o.id as string } : {}),
    nit: nit.nit,
    dv: nit.dv,
    tipoPersona: o.tipoPersona as TipoPersona,
    razonSocial,
    nombreComercial: texto(o.nombreComercial ?? "", "Nombre comercial", 200).trim(),
    contacto: texto(o.contacto ?? "", "Contacto", 120).trim(),
    telefono: texto(o.telefono ?? "", "Teléfono", 40).trim(),
    correo,
    ciudad: texto(o.ciudad ?? "", "Ciudad", 80).trim(),
    direccion: texto(o.direccion ?? "", "Dirección", 200).trim(),
    categorias: [...new Set(o.categorias as TipoInsumo[])],
    responsableIva: o.responsableIva,
    observaciones: texto(o.observaciones ?? "", "Observaciones", 1000).trim(),
    version: version(o.version),
  };
}

export function leerEstadoProveedor(body: unknown): CambioEstadoProveedor {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.estado !== "activo" && o.estado !== "inactivo" && o.estado !== "bloqueado") bad("Estado no válido.");
  return { estado: o.estado as EstadoProveedor, motivo: texto(o.motivo ?? "", "Motivo", 500).trim(), version: version(o.version) };
}

// ---------------------------------------------------------------- quotations

function entero(value: unknown, what: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) bad(`${what}: número entero entre 0 y ${max}.`);
  return value;
}

function porcentaje(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) bad(`${what}: entre 0 y 100 %.`);
  return Math.round(value * 100) / 100;
}

export function leerCambioCotizacion(body: unknown): CambioCotizacion {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) bad("Cotización no válida.");
  if (typeof o.requisicionId !== "string" || !UUID_RE.test(o.requisicionId)) bad("Requisición no válida.");
  if (typeof o.proveedorId !== "string" || !UUID_RE.test(o.proveedorId)) bad("Elige el proveedor.");
  const fechaC = fecha(o.fecha, "Fecha de la cotización");
  const vigencia = fecha(o.vigenciaHasta, "Vigente hasta");
  if (vigencia < fechaC) bad("La vigencia no puede terminar antes de la fecha de la cotización.");
  if (!Array.isArray(o.lineas) || !o.lineas.length) bad("La cotización necesita al menos un precio.");
  if (o.lineas.length > MAX_LINEAS_REQUISICION) bad(`Máximo ${MAX_LINEAS_REQUISICION} líneas.`);
  const lineas = o.lineas.map((v, i) => {
    const l = (v ?? {}) as Record<string, unknown>;
    if (typeof l.requisicionLineaId !== "string" || !UUID_RE.test(l.requisicionLineaId)) bad(`Línea ${i + 1}: no válida.`);
    const c = cantidad(l.cantidad, `Línea ${i + 1}`);
    if (c <= 0) bad(`Línea ${i + 1}: la cantidad debe ser mayor que cero.`);
    const precio = l.precioUnitario;
    if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0 || precio > 1e13) bad(`Línea ${i + 1}: precio no válido.`);
    return {
      requisicionLineaId: l.requisicionLineaId,
      cantidad: c,
      precioUnitario: Math.round(precio * 100) / 100,
      descuentoPct: porcentaje(l.descuentoPct ?? 0, `Línea ${i + 1}: descuento`),
      ivaPct: porcentaje(l.ivaPct ?? 0, `Línea ${i + 1}: IVA`),
    };
  });
  if (new Set(lineas.map((l) => l.requisicionLineaId)).size !== lineas.length) bad("Una línea de la requisición está dos veces.");
  return {
    ...(o.id ? { id: o.id as string } : {}),
    requisicionId: o.requisicionId,
    proveedorId: o.proveedorId,
    referencia: texto(o.referencia ?? "", "Referencia", 80).trim(),
    fecha: fechaC,
    vigenciaHasta: vigencia,
    plazoEntregaDias: entero(o.plazoEntregaDias, "Plazo de entrega (días)", 3650),
    diasPago: entero(o.diasPago, "Días de pago", 3650),
    anticipoPct: porcentaje(o.anticipoPct ?? 0, "Anticipo"),
    formaPago: texto(o.formaPago ?? "", "Forma de pago", 200).trim(),
    observaciones: texto(o.observaciones ?? "", "Observaciones", 1000).trim(),
    lineas,
    version: version(o.version),
  };
}

export function leerAnulacion(body: unknown): { motivo: string; version: number } {
  const o = (body ?? {}) as Record<string, unknown>;
  return { motivo: texto(o.motivo ?? "", "Motivo", 1000).trim(), version: version(o.version) };
}

const ACCION_COMPARATIVO_RE = /^(guardar|proponer|aprobar|devolver)$/;

export function leerAccionComparativo(body: unknown): AccionSobreComparativo {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.accion !== "string" || !ACCION_COMPARATIVO_RE.test(o.accion)) bad("Acción no válida.");
  const c = (o.criterios ?? {}) as Record<string, unknown>;
  const criterios = { precio: entero(c.precio, "Peso del precio", 100), entrega: entero(c.entrega, "Peso de la entrega", 100), pago: entero(c.pago, "Peso del pago", 100) };
  if (criterios.precio + criterios.entrega + criterios.pago !== 100) bad("Los pesos de los criterios deben sumar 100.");
  const elegida = o.cotizacionElegidaId ?? null;
  if (elegida !== null && (typeof elegida !== "string" || !UUID_RE.test(elegida))) bad("Cotización no válida.");
  return {
    accion: o.accion as AccionComparativo,
    criterios,
    cotizacionElegidaId: elegida as string | null,
    justificacion: texto(o.justificacion ?? "", "Justificación", 1000).trim(),
    motivo: texto(o.motivo ?? "", "Motivo", 1000).trim(),
    version: version(o.version),
  };
}

// ---------------------------------------------------------------- orders and contracts

const ACCION_ORDEN_RE = /^(enviar|aprobar|devolver|anular|modificar)$/;

export function leerCambioOrden(body: unknown): CambioOrden {
  const o = (body ?? {}) as Record<string, unknown>;
  if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) bad("Orden no válida.");
  if (o.tipo !== "orden" && o.tipo !== "contrato") bad("Tipo no válido: orden de compra o contrato.");
  if (typeof o.requisicionId !== "string" || !UUID_RE.test(o.requisicionId)) bad("Requisición no válida.");
  if (!Array.isArray(o.lineas) || !o.lineas.length) bad("La orden necesita al menos un insumo.");
  if (o.lineas.length > MAX_LINEAS_REQUISICION) bad(`Máximo ${MAX_LINEAS_REQUISICION} líneas.`);
  const lineas = o.lineas.map((x, i) => {
    const l = (x ?? {}) as Record<string, unknown>;
    if (typeof l.requisicionLineaId !== "string" || !UUID_RE.test(l.requisicionLineaId)) bad(`Línea ${i + 1}: no válida.`);
    const c = cantidad(l.cantidad, `Línea ${i + 1}`);
    if (c <= 0) bad(`Línea ${i + 1}: la cantidad debe ser mayor que cero.`);
    const precio = l.precioUnitario;
    if (precio !== undefined && (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0 || precio > 1e13)) bad(`Línea ${i + 1}: precio no válido.`);
    return {
      requisicionLineaId: l.requisicionLineaId,
      cantidad: c,
      ...(precio !== undefined ? { precioUnitario: Math.round((precio as number) * 100) / 100 } : {}),
      ...(l.descuentoPct !== undefined ? { descuentoPct: porcentaje(l.descuentoPct, `Línea ${i + 1}: descuento`) } : {}),
      ...(l.ivaPct !== undefined ? { ivaPct: porcentaje(l.ivaPct, `Línea ${i + 1}: IVA`) } : {}),
    };
  });
  if (new Set(lineas.map((l) => l.requisicionLineaId)).size !== lineas.length) bad("Una línea de la requisición está dos veces.");
  return {
    ...(o.id ? { id: o.id as string } : {}),
    tipo: o.tipo,
    requisicionId: o.requisicionId,
    fechaEntrega: fecha(o.fechaEntrega, o.tipo === "contrato" ? "Fecha de terminación" : "Fecha de entrega"),
    lugarEntrega: texto(o.lugarEntrega ?? "", "Lugar de entrega", 200).trim(),
    formaPago: texto(o.formaPago ?? "", "Forma de pago", 200).trim(),
    diasPago: entero(o.diasPago ?? 0, "Días de pago", 3650),
    anticipoPct: porcentaje(o.anticipoPct ?? 0, "Anticipo"),
    retencionGarantiaPct: porcentaje(o.retencionGarantiaPct ?? 0, "Retención de garantía"),
    objeto: texto(o.objeto ?? "", "Objeto", 2000).trim(),
    polizas: texto(o.polizas ?? "", "Pólizas", 1000).trim(),
    observaciones: texto(o.observaciones ?? "", "Observaciones", 1000).trim(),
    lineas,
    version: version(o.version),
  };
}

export function leerAccionOrden(body: unknown): AccionSobreOrden {
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.accion !== "string" || !ACCION_ORDEN_RE.test(o.accion)) bad("Acción no válida.");
  return { accion: o.accion as AccionOrden, motivo: texto(o.motivo ?? "", "Motivo", 1000).trim(), version: version(o.version) };
}
