import { redondear } from "../presupuesto/calc";
import { MotivoRechazo, tiene } from "./accesos";
import type { AccionRequisicion, AccionSobreRequisicion, EstadoRequisicion, LineaRequisicion, Permiso, Requisicion } from "./types";

/**
 * The rules of requisitions, as pure functions. supabase/compras.sql checks
 * the same ones again inside one transaction per project (so two people at
 * once can't pass a resource's limit between them).
 */

export const ESTADOS_REQUISICION: Record<EstadoRequisicion, { texto: string; color: string; fondo: string }> = {
  borrador: { texto: "Borrador", color: "#3c4550", fondo: "#eef1f4" },
  enviada: { texto: "Por aprobar", color: "#7a5a00", fondo: "#fff4d1" },
  aprobada: { texto: "Aprobada", color: "#2e6b22", fondo: "#e3f3de" },
  rechazada: { texto: "Rechazada", color: "#b3261e", fondo: "#fbe4e2" },
  anulada: { texto: "Anulada", color: "#6b7684", fondo: "#eef1f4" },
};

/** Which states each action starts from and where it leaves the requisition. */
export const TRANSICIONES: Record<AccionRequisicion, { nombre: string; desde: EstadoRequisicion[]; hacia: EstadoRequisicion }> = {
  enviar: { nombre: "Enviar a aprobación", desde: ["borrador"], hacia: "enviada" },
  aprobar: { nombre: "Aprobar", desde: ["enviada"], hacia: "aprobada" },
  rechazar: { nombre: "Rechazar", desde: ["enviada"], hacia: "rechazada" },
  devolver: { nombre: "Devolver para corregir", desde: ["enviada"], hacia: "borrador" },
  anular: { nombre: "Anular", desde: ["borrador", "enviada", "aprobada"], hacia: "anulada" },
};

/** Decisions that the person who asked can't take on their own requisition. */
const DECISIONES: AccionRequisicion[] = ["aprobar", "rechazar", "devolver"];
const CON_MOTIVO: AccionRequisicion[] = ["rechazar", "devolver", "anular"];

export function numeroRequisicion(n: number): string {
  return `REQ-${String(n).padStart(4, "0")}`;
}

export interface Pedido {
  solicitado: number;
  aprobado: number;
}

/**
 * What is asked of each resource: sent requisitions count with their whole
 * quantity, approved ones with what was approved; drafts, rejected and
 * cancelled ones don't count.
 */
export function solicitadoPorInsumo(requisiciones: Requisicion[], excluirId?: string): Map<string, Pedido> {
  const out = new Map<string, Pedido>();
  for (const r of requisiciones) {
    if (r.id === excluirId || (r.estado !== "enviada" && r.estado !== "aprobada")) continue;
    for (const l of r.lineas) {
      const p = out.get(l.insumoId) ?? { solicitado: 0, aprobado: 0 };
      const aprobada = r.estado === "aprobada" ? l.cantidadAprobada ?? 0 : 0;
      p.solicitado = redondear(p.solicitado + (r.estado === "aprobada" ? aprobada : l.cantidad), 4);
      p.aprobado = redondear(p.aprobado + aprobada, 4);
      out.set(l.insumoId, p);
    }
  }
  return out;
}

/** The most that can be asked of a resource without a justification: planned plus the tolerance. */
export function limite(planificado: number, toleranciaPct: number): number {
  return redondear(planificado * (1 + toleranciaPct / 100), 4);
}

export interface Exceso {
  insumoId: string;
  descripcion: string;
  unidad: string;
  planificado: number;
  limite: number;
  /** Already asked in other requisitions. */
  otros: number;
  /** Asked in this one. */
  pedido: number;
}

/** The resources whose total (other requisitions + `lineas`) passes their limit. A resource no longer in the budget has limit 0. */
export function excesos(
  lineas: Pick<LineaRequisicion, "insumoId" | "descripcion" | "unidad" | "cantidad">[],
  planificados: Map<string, number>,
  toleranciaPct: number,
  otros: Map<string, Pedido>
): Exceso[] {
  const porInsumo = new Map<string, Exceso>();
  for (const l of lineas) {
    const e = porInsumo.get(l.insumoId);
    if (e) e.pedido = redondear(e.pedido + l.cantidad, 4);
    else {
      const planificado = planificados.get(l.insumoId) ?? 0;
      porInsumo.set(l.insumoId, {
        insumoId: l.insumoId,
        descripcion: l.descripcion,
        unidad: l.unidad,
        planificado,
        limite: limite(planificado, toleranciaPct),
        otros: otros.get(l.insumoId)?.solicitado ?? 0,
        pedido: redondear(l.cantidad, 4),
      });
    }
  }
  return [...porInsumo.values()].filter((e) => redondear(e.otros + e.pedido, 4) > e.limite);
}

/** A draft can be changed by whoever can edit requisitions, or by the person who asked if they can create them. */
export function puedeEditar(r: Pick<Requisicion, "estado" | "solicitanteId">, actorId: string, permisos: readonly Permiso[]): boolean {
  return r.estado === "borrador" && (tiene(permisos, "requisiciones", "editar") || (r.solicitanteId === actorId && tiene(permisos, "requisiciones", "crear")));
}

/** The quantities that would be approved: what was given per line, or the whole line. */
export function cantidadesAprobadas(r: Requisicion, aprobadas: Record<string, number> | undefined): LineaRequisicion[] {
  return r.lineas.map((l) => ({ ...l, cantidad: redondear(aprobadas?.[l.id] ?? l.cantidad, 4) }));
}

export interface ContextoRequisicion {
  actorId: string;
  permisos: readonly Permiso[];
  /** YYYY-MM-DD */
  hoy: string;
  toleranciaPct: number;
  /** Planned quantity of each resource in the current budget. */
  planificados: Map<string, number>;
  /** Every requisition of the project (to add up what was already asked). */
  requisiciones: Requisicion[];
}

/** Can the caller try this action now (state and permission), for the screen's buttons. */
export function puedeAccion(ctx: Pick<ContextoRequisicion, "actorId" | "permisos">, r: Requisicion, accion: AccionRequisicion): boolean {
  if (!TRANSICIONES[accion].desde.includes(r.estado)) return false;
  if (accion === "enviar") return puedeEditar(r, ctx.actorId, ctx.permisos);
  if (DECISIONES.includes(accion)) return tiene(ctx.permisos, "requisiciones", "aprobar") && r.solicitanteId !== ctx.actorId;
  return tiene(ctx.permisos, "requisiciones", "anular");
}

/** Why `a` can't be done to `r` now, or null if it can. */
export function revisarAccion(ctx: ContextoRequisicion, r: Requisicion, a: AccionSobreRequisicion): MotivoRechazo | null {
  if (!TRANSICIONES[a.accion].desde.includes(r.estado)) return "estado-no-valido";
  if (a.accion === "enviar" ? !puedeEditar(r, ctx.actorId, ctx.permisos) : !tiene(ctx.permisos, "requisiciones", DECISIONES.includes(a.accion) ? "aprobar" : "anular")) {
    return "sin-permiso";
  }
  if (DECISIONES.includes(a.accion) && r.solicitanteId === ctx.actorId) return "auto-aprobacion";
  if (CON_MOTIVO.includes(a.accion) && !a.motivo.trim()) return "motivo-requerido";
  if (r.version !== a.version) return "version-conflict";

  const otros = solicitadoPorInsumo(ctx.requisiciones, r.id);
  if (a.accion === "enviar") {
    if (!r.lineas.length) return "sin-lineas";
    if (!r.justificacion.trim()) return "justificacion-requerida";
    if (r.fechaRequerida < ctx.hoy) return "fecha-pasada";
    const pasan = new Set(excesos(r.lineas, ctx.planificados, ctx.toleranciaPct, otros).map((e) => e.insumoId));
    if (r.lineas.some((l) => pasan.has(l.insumoId) && !l.justificacionExceso.trim())) return "cantidad-excedida";
  }
  if (a.accion === "aprobar") {
    const aprobadas = cantidadesAprobadas(r, a.aprobadas);
    const original = new Map(r.lineas.map((l) => [l.id, l.cantidad]));
    if (Object.keys(a.aprobadas ?? {}).some((id) => !original.has(id))) return "cantidad-no-valida";
    if (aprobadas.some((l) => !(l.cantidad >= 0) || l.cantidad > (original.get(l.id) ?? 0)) || !aprobadas.some((l) => l.cantidad > 0)) return "cantidad-no-valida";
    if (excesos(aprobadas, ctx.planificados, ctx.toleranciaPct, otros).length && !tiene(ctx.permisos, "requisiciones", "exceder")) return "exceso-sin-permiso";
  }
  return null;
}
