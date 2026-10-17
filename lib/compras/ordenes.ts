import { redondear } from "../presupuesto/calc";
import { MotivoRechazo, tiene } from "./accesos";
import { TIPO_ORDEN } from "./types";
import type { AccionOrden, AccionSobreOrden, CambioOrden, Comparativo, Cotizacion, EstadoOrden, LineaRequisicion, Orden, Permiso, Requisicion, TipoOrden } from "./types";

/**
 * Purchase orders and contracts, as pure functions. The key rule: what is
 * ordered of a requisition line, adding every order and contract not
 * cancelled (drafts included), never passes what was approved nor what the
 * chosen supplier quoted. supabase/compras.sql checks it again under a lock
 * and with a deferred trigger.
 */

export function numeroOrden(tipo: TipoOrden, n: number): string {
  return `${TIPO_ORDEN[tipo].prefijo}-${String(n).padStart(4, "0")}`;
}

export const ESTADOS_ORDEN: Record<EstadoOrden, { texto: string; color: string; fondo: string }> = {
  borrador: { texto: "Borrador", color: "#3c4550", fondo: "#eef1f4" },
  enviada: { texto: "Por aprobar", color: "#7a5a00", fondo: "#fff4d1" },
  aprobada: { texto: "Emitida", color: "#2e6b22", fondo: "#e3f3de" },
  anulada: { texto: "Anulada", color: "#6b7684", fondo: "#eef1f4" },
};

export const TRANSICIONES_ORDEN: Record<AccionOrden, { nombre: string; desde: EstadoOrden[]; hacia: EstadoOrden }> = {
  enviar: { nombre: "Enviar a aprobación", desde: ["borrador"], hacia: "enviada" },
  aprobar: { nombre: "Aprobar y emitir", desde: ["enviada"], hacia: "aprobada" },
  devolver: { nombre: "Devolver", desde: ["enviada"], hacia: "borrador" },
  anular: { nombre: "Anular", desde: ["borrador", "enviada", "aprobada"], hacia: "anulada" },
  modificar: { nombre: "Modificar", desde: ["aprobada"], hacia: "borrador" },
};

const CON_MOTIVO: AccionOrden[] = ["devolver", "anular", "modificar"];

/** What is ordered of each requisition line in orders and contracts not cancelled (drafts included). */
export function comprometidoPorLinea(ordenes: Orden[], excluirId?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of ordenes) {
    if (o.estado === "anulada" || o.id === excluirId) continue;
    for (const l of o.lineas) out.set(l.requisicionLineaId, redondear((out.get(l.requisicionLineaId) ?? 0) + l.cantidad, 4));
  }
  return out;
}

/** What is committed of each resource: in approved (issued) orders and contracts. */
export function comprometidoPorInsumo(ordenes: Orden[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of ordenes) {
    if (o.estado !== "aprobada") continue;
    for (const l of o.lineas) out.set(l.insumoId, redondear((out.get(l.insumoId) ?? 0) + l.cantidad, 4));
  }
  return out;
}

/** The most that can still be ordered of a requisition line: approved and quoted, less what other orders took. */
export function maximoLinea(l: Pick<LineaRequisicion, "cantidadAprobada">, cotizado: number, otros: number): number {
  return Math.max(0, redondear(Math.min(l.cantidadAprobada ?? 0, cotizado) - otros, 4));
}

export function puedeEditarOrden(o: Pick<Orden, "estado" | "tipo" | "elaboradoPorId">, actorId: string, permisos: readonly Permiso[]): boolean {
  const m = TIPO_ORDEN[o.tipo].modulo;
  return o.estado === "borrador" && (tiene(permisos, m, "editar") || (o.elaboradoPorId === actorId && tiene(permisos, m, "crear")));
}

export interface ContextoOrdenes {
  actorId: string;
  permisos: readonly Permiso[];
  hoy: string;
}

/** Why this draft can't be saved (null: it can). */
export function revisarOrden(
  ctx: ContextoOrdenes,
  c: CambioOrden,
  antes: Orden | null,
  r: Requisicion | undefined,
  comparativo: Comparativo | undefined,
  cotizacion: Cotizacion | undefined,
  ordenes: Orden[]
): MotivoRechazo | null {
  const m = TIPO_ORDEN[c.tipo].modulo;
  if (antes) {
    if (antes.tipo !== c.tipo || antes.requisicionId !== c.requisicionId) return "datos";
    if (antes.estado !== "borrador") return "estado-no-valido";
    if (!puedeEditarOrden(antes, ctx.actorId, ctx.permisos)) return "sin-permiso";
  } else if (!tiene(ctx.permisos, m, "crear")) return "sin-permiso";
  if (!r) return "no-existe";
  if (r.estado !== "aprobada") return "requisicion-no-aprobada";
  if (comparativo?.estado !== "aprobado" || !cotizacion || comparativo.cotizacionElegidaId !== cotizacion.id) return "sin-proveedor-elegido";
  if (!c.lineas.length) return "sin-lineas";
  const otros = comprometidoPorLinea(ordenes, antes?.id);
  const vistas = new Set<string>();
  for (const l of c.lineas) {
    const rl = r.lineas.find((x) => x.id === l.requisicionLineaId);
    const cl = cotizacion.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId);
    if (!rl || !cl || !((rl.cantidadAprobada ?? 0) > 0) || vistas.has(l.requisicionLineaId)) return "datos";
    vistas.add(l.requisicionLineaId);
    if (!(l.cantidad > 0)) return "cantidad-no-valida";
    if (l.cantidad > maximoLinea(rl, cl.cantidad, otros.get(l.requisicionLineaId) ?? 0)) return "doble-compromiso";
  }
  if ((antes?.version ?? 0) !== c.version) return "version-conflict";
  return null;
}

/** Can the caller try this action now (state and permission), for the screen's buttons. */
export function puedeAccionOrden(ctx: Pick<ContextoOrdenes, "actorId" | "permisos">, o: Orden, accion: AccionOrden): boolean {
  if (!TRANSICIONES_ORDEN[accion].desde.includes(o.estado)) return false;
  const m = TIPO_ORDEN[o.tipo].modulo;
  if (accion === "enviar") return puedeEditarOrden(o, ctx.actorId, ctx.permisos);
  if (accion === "aprobar" || accion === "devolver") return tiene(ctx.permisos, m, "aprobar") && o.elaboradoPorId !== ctx.actorId;
  if (accion === "modificar") return tiene(ctx.permisos, m, "editar");
  return tiene(ctx.permisos, m, "anular");
}

/** Why `a` can't be done to the order now (null: it can). */
export function revisarAccionOrden(ctx: ContextoOrdenes, o: Orden, a: AccionSobreOrden): MotivoRechazo | null {
  if (!TRANSICIONES_ORDEN[a.accion].desde.includes(o.estado)) return "estado-no-valido";
  const m = TIPO_ORDEN[o.tipo].modulo;
  const permitido =
    a.accion === "enviar"
      ? puedeEditarOrden(o, ctx.actorId, ctx.permisos)
      : a.accion === "aprobar" || a.accion === "devolver"
        ? tiene(ctx.permisos, m, "aprobar")
        : tiene(ctx.permisos, m, a.accion === "modificar" ? "editar" : "anular");
  if (!permitido) return "sin-permiso";
  if ((a.accion === "aprobar" || a.accion === "devolver") && o.elaboradoPorId === ctx.actorId) return "auto-aprobacion";
  if (CON_MOTIVO.includes(a.accion) && !a.motivo.trim()) return "motivo-requerido";
  if (o.version !== a.version) return "version-conflict";
  if (a.accion === "enviar") {
    if (!o.lineas.length) return "sin-lineas";
    if (o.tipo === "contrato" && !o.objeto.trim()) return "objeto-requerido";
    if (o.fechaEntrega < ctx.hoy) return "fecha-pasada";
  }
  return null;
}
