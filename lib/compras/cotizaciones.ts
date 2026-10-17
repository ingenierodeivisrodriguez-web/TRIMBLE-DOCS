import { redondear } from "../presupuesto/calc";
import { MotivoRechazo, tiene } from "./accesos";
import type {
  AccionSobreComparativo,
  CambioCotizacion,
  Comparativo,
  Cotizacion,
  Criterios,
  EstadoComparativo,
  LineaCotizacion,
  Permiso,
  Proveedor,
  Requisicion,
} from "./types";

/**
 * Quotations and their comparison, as pure functions: totals, coverage of
 * what was approved, scores by weighted criteria, and the rules to propose
 * and approve the chosen one. supabase/compras.sql checks the critical ones
 * again (states, permissions, who proposes doesn't approve).
 */

export function numeroCotizacion(n: number): string {
  return `COT-${String(n).padStart(4, "0")}`;
}

export const ESTADOS_COMPARATIVO: Record<EstadoComparativo | "sin", { texto: string; color: string; fondo: string }> = {
  sin: { texto: "Sin comparativo", color: "#6b7684", fondo: "#eef1f4" },
  borrador: { texto: "En preparación", color: "#3c4550", fondo: "#eef1f4" },
  propuesto: { texto: "Por aprobar", color: "#7a5a00", fondo: "#fff4d1" },
  aprobado: { texto: "Proveedor elegido", color: "#2e6b22", fondo: "#e3f3de" },
};

export interface TotalesLinea {
  bruto: number;
  descuento: number;
  neto: number;
  iva: number;
  total: number;
}

export function totalesLinea(l: Pick<LineaCotizacion, "cantidad" | "precioUnitario" | "descuentoPct" | "ivaPct">): TotalesLinea {
  const bruto = redondear(l.cantidad * l.precioUnitario, 2);
  const descuento = redondear((bruto * l.descuentoPct) / 100, 2);
  const neto = redondear(bruto - descuento, 2);
  const iva = redondear((neto * l.ivaPct) / 100, 2);
  return { bruto, descuento, neto, iva, total: redondear(neto + iva, 2) };
}

export function totalesCotizacion(c: Pick<Cotizacion, "lineas">): TotalesLinea {
  const t = { bruto: 0, descuento: 0, neto: 0, iva: 0, total: 0 };
  for (const l of c.lineas) {
    const x = totalesLinea(l);
    t.bruto += x.bruto;
    t.descuento += x.descuento;
    t.neto += x.neto;
    t.iva += x.iva;
    t.total += x.total;
  }
  return { bruto: redondear(t.bruto, 2), descuento: redondear(t.descuento, 2), neto: redondear(t.neto, 2), iva: redondear(t.iva, 2), total: redondear(t.total, 2) };
}

/** The requisition lines that can be quoted: those approved with something. */
export function lineasAprobadas(r: Requisicion) {
  return r.lineas.filter((l) => (l.cantidadAprobada ?? 0) > 0);
}

/** Does the quotation price everything approved, in full? */
export function cobertura(c: Pick<Cotizacion, "lineas">, r: Requisicion): { cubiertas: number; de: number; completa: boolean } {
  const aprobadas = lineasAprobadas(r);
  const porLinea = new Map(c.lineas.map((l) => [l.requisicionLineaId, l.cantidad]));
  const cubiertas = aprobadas.filter((l) => (porLinea.get(l.id) ?? 0) >= (l.cantidadAprobada ?? 0)).length;
  return { cubiertas, de: aprobadas.length, completa: aprobadas.length > 0 && cubiertas === aprobadas.length };
}

export interface Evaluacion {
  cotizacionId: string;
  total: number;
  completa: boolean;
  vigente: boolean;
  proveedorActivo: boolean;
  /** Can be chosen: registered, still valid and from an active supplier. */
  elegible: boolean;
  /** Why it can't be chosen ("" when it can). */
  motivo: string;
  puntajes: Criterios;
  /** Weighted score, 0 to 100 (0 when not eligible). */
  puntaje: number;
  /** The best eligible one that covers everything. */
  mejor: boolean;
}

/**
 * Scores the requisition's quotations. Price: the lowest total among the
 * comparable ones (eligible and complete) over each total. Delivery: the
 * shortest time over each one (counting days + 1). Payment: each one's days
 * of credit over the longest (days + 1).
 */
export function evaluar(cotizaciones: Cotizacion[], r: Requisicion, proveedores: Map<string, Proveedor>, criterios: Criterios, hoy: string): Evaluacion[] {
  const base = cotizaciones
    .filter((c) => c.requisicionId === r.id && c.estado === "registrada")
    .map((c) => {
      const vigente = c.vigenciaHasta >= hoy;
      const proveedorActivo = proveedores.get(c.proveedorId)?.estado === "activo";
      const motivo = !vigente ? `Vencida el ${c.vigenciaHasta.split("-").reverse().join("-")}` : !proveedorActivo ? "Proveedor no activo" : "";
      return { c, total: totalesCotizacion(c).total, completa: cobertura(c, r).completa, vigente, proveedorActivo, elegible: vigente && proveedorActivo, motivo };
    });
  const elegibles = base.filter((x) => x.elegible);
  const comparables = elegibles.filter((x) => x.completa);
  const referencia = comparables.length ? comparables : elegibles;
  const minTotal = Math.min(...referencia.map((x) => x.total).filter((t) => t > 0));
  const minPlazo = Math.min(...elegibles.map((x) => x.c.plazoEntregaDias));
  const maxPago = Math.max(...elegibles.map((x) => x.c.diasPago));

  const out: Evaluacion[] = base.map((x) => {
    const puntajes: Criterios = x.elegible
      ? {
          precio: x.total > 0 && Number.isFinite(minTotal) ? redondear((Math.min(minTotal, x.total) / x.total) * 100, 2) : 0,
          entrega: redondear(((minPlazo + 1) / (x.c.plazoEntregaDias + 1)) * 100, 2),
          pago: redondear(((x.c.diasPago + 1) / (maxPago + 1)) * 100, 2),
        }
      : { precio: 0, entrega: 0, pago: 0 };
    const puntaje = x.elegible ? redondear((puntajes.precio * criterios.precio + puntajes.entrega * criterios.entrega + puntajes.pago * criterios.pago) / 100, 2) : 0;
    return { cotizacionId: x.c.id, total: x.total, completa: x.completa, vigente: x.vigente, proveedorActivo: x.proveedorActivo, elegible: x.elegible, motivo: x.motivo, puntajes, puntaje, mejor: false };
  });
  const mejor = out
    .filter((e) => e.elegible && e.completa)
    .sort((a, b) => b.puntaje - a.puntaje || a.total - b.total)[0];
  if (mejor) mejor.mejor = true;
  return out;
}

/** Why choosing `elegidaId` needs a written justification (empty: it doesn't). */
export function razonesJustificacion(evaluaciones: Evaluacion[], elegidaId: string | null, minCotizaciones: number): string[] {
  const razones: string[] = [];
  const elegida = evaluaciones.find((e) => e.cotizacionId === elegidaId);
  const elegibles = evaluaciones.filter((e) => e.elegible).length;
  if (elegibles < minCotizaciones) razones.push(`Hay ${elegibles} cotización(es) vigente(s) y se esperan al menos ${minCotizaciones}.`);
  if (elegida && !elegida.completa) razones.push("La elegida no cubre todo lo aprobado.");
  if (elegida && !elegida.mejor && evaluaciones.some((e) => e.mejor)) razones.push("La elegida no es la de mejor puntaje.");
  return razones;
}

export function criteriosValidos(c: Criterios): boolean {
  const v = [c.precio, c.entrega, c.pago];
  return v.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) && v.reduce((a, b) => a + b, 0) === 100;
}

export interface ContextoCotizaciones {
  actorId: string;
  permisos: readonly Permiso[];
  hoy: string;
  minCotizaciones: number;
}

/** Why this quotation can't be saved (null: it can). */
export function revisarCotizacion(
  ctx: ContextoCotizaciones,
  c: CambioCotizacion,
  antes: Cotizacion | null,
  r: Requisicion | undefined,
  comparativo: Comparativo | undefined,
  proveedor: Proveedor | undefined,
  todas: Cotizacion[]
): MotivoRechazo | null {
  if (!tiene(ctx.permisos, "cotizaciones", antes ? "editar" : "crear")) return "sin-permiso";
  if (!r) return "no-existe";
  if (r.estado !== "aprobada") return "requisicion-no-aprobada";
  if (antes && (antes.estado !== "registrada" || antes.requisicionId !== c.requisicionId)) return "estado-no-valido";
  if (comparativo && comparativo.estado !== "borrador") return "comparativo-cerrado";
  if (!proveedor) return "no-existe";
  if (proveedor.estado !== "activo") return "proveedor-no-activo";
  if (todas.some((x) => x.id !== antes?.id && x.requisicionId === c.requisicionId && x.proveedorId === c.proveedorId && x.estado === "registrada")) return "cotizacion-duplicada";
  if (c.vigenciaHasta < c.fecha) return "datos";
  const aprobadas = new Map(lineasAprobadas(r).map((l) => [l.id, l.cantidadAprobada ?? 0]));
  if (!c.lineas.length) return "sin-lineas";
  const vistas = new Set<string>();
  for (const l of c.lineas) {
    const max = aprobadas.get(l.requisicionLineaId);
    if (max === undefined || vistas.has(l.requisicionLineaId)) return "datos";
    vistas.add(l.requisicionLineaId);
    if (!(l.cantidad > 0) || l.cantidad > max) return "cantidad-no-valida";
  }
  if (antes && antes.version !== c.version) return "version-conflict";
  if (!antes && c.version !== 0) return "version-conflict";
  return null;
}

/** Why this action on the comparison can't be done (null: it can). */
export function revisarComparativo(
  ctx: ContextoCotizaciones,
  r: Requisicion,
  comparativo: Comparativo | undefined,
  evaluaciones: Evaluacion[],
  a: AccionSobreComparativo
): MotivoRechazo | null {
  const estado = comparativo?.estado ?? "borrador";
  const prepara = tiene(ctx.permisos, "cotizaciones", "crear") || tiene(ctx.permisos, "cotizaciones", "editar");
  if (a.accion === "guardar" || a.accion === "proponer") {
    if (!prepara) return "sin-permiso";
  } else {
    if (!tiene(ctx.permisos, "cotizaciones", "aprobar")) return "sin-permiso";
    if (comparativo?.propuestoPorId === ctx.actorId) return "auto-aprobacion";
  }
  if (r.estado !== "aprobada") return "requisicion-no-aprobada";
  if ((a.accion === "guardar" || a.accion === "proponer") && estado !== "borrador") return "estado-no-valido";
  if ((a.accion === "aprobar" || a.accion === "devolver") && estado !== "propuesto") return "estado-no-valido";
  if ((comparativo?.version ?? 0) !== a.version) return "version-conflict";
  if (!criteriosValidos(a.criterios)) return "datos";
  if (a.accion === "devolver" && !a.motivo.trim()) return "motivo-requerido";
  if (a.accion === "proponer" || a.accion === "aprobar") {
    const elegidaId = a.accion === "aprobar" ? comparativo?.cotizacionElegidaId ?? null : a.cotizacionElegidaId;
    const elegida = evaluaciones.find((e) => e.cotizacionId === elegidaId);
    if (!elegida || !elegida.elegible) return "cotizacion-no-elegible";
    if (a.accion === "proponer" && razonesJustificacion(evaluaciones, elegidaId, ctx.minCotizaciones).length && !a.justificacion.trim()) return "justificacion-requerida";
  }
  return null;
}
