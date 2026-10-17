import { redondear } from "../presupuesto/calc";
import { MotivoRechazo, tiene } from "./accesos";
import { nitConDv } from "./proveedores";
import type { AccionRecepcion, AccionSobreRecepcion, CambioRecepcion, EstadoRecepcion, Orden, OrdenPorRecibir, Permiso, Proveedor, Recepcion } from "./types";

/**
 * Receptions on site, as pure functions. The key rules: accepted plus
 * rejected equals received, what goes back never passes what was rejected,
 * and what is accepted of an order line, adding every reception not
 * cancelled (drafts included), never passes what was ordered. In turn an
 * order with receptions can't be cancelled nor brought below what was
 * accepted. supabase/compras.sql checks all of it again under a lock and
 * with deferred triggers.
 */

export function numeroRecepcion(n: number): string {
  return `REC-${String(n).padStart(4, "0")}`;
}

export const ESTADOS_RECEPCION: Record<EstadoRecepcion, { texto: string; color: string; fondo: string }> = {
  borrador: { texto: "Borrador", color: "#3c4550", fondo: "#eef1f4" },
  enviada: { texto: "Por aprobar", color: "#7a5a00", fondo: "#fff4d1" },
  aprobada: { texto: "Aprobada", color: "#2e6b22", fondo: "#e3f3de" },
  anulada: { texto: "Anulada", color: "#6b7684", fondo: "#eef1f4" },
};

export const TRANSICIONES_RECEPCION: Record<AccionRecepcion, { nombre: string; desde: EstadoRecepcion[]; hacia: EstadoRecepcion }> = {
  enviar: { nombre: "Enviar a aprobación", desde: ["borrador"], hacia: "enviada" },
  aprobar: { nombre: "Aprobar", desde: ["enviada"], hacia: "aprobada" },
  devolver: { nombre: "Devolver", desde: ["enviada"], hacia: "borrador" },
  anular: { nombre: "Anular", desde: ["borrador", "enviada", "aprobada"], hacia: "anulada" },
};

const CON_MOTIVO: AccionRecepcion[] = ["devolver", "anular"];

const clave = (ordenId: string, requisicionLineaId: string) => `${ordenId}|${requisicionLineaId}`;

/** Accepted of each order line ("orden|requisition line") in receptions not cancelled (drafts included). */
export function aceptadoPorLinea(recepciones: Recepcion[], excluirId?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of recepciones) {
    if (r.estado === "anulada" || r.id === excluirId) continue;
    for (const l of r.lineas) out.set(clave(r.ordenId, l.requisicionLineaId), redondear((out.get(clave(r.ordenId, l.requisicionLineaId)) ?? 0) + l.aceptado, 4));
  }
  return out;
}

/** Accepted of each line of one order in receptions not cancelled, by requisition line. */
export function aceptadoDeOrden(recepciones: Recepcion[], ordenId: string): Map<string, number> {
  return new Map(
    [...aceptadoPorLinea(recepciones.filter((r) => r.ordenId === ordenId))].map(([k, v]) => [k.split("|")[1], v])
  );
}

/** Does the order have receptions not cancelled (then it can't be cancelled). */
export function tieneRecepciones(recepciones: Recepcion[], ordenId: string): boolean {
  return recepciones.some((r) => r.ordenId === ordenId && r.estado !== "anulada");
}

/** What is accepted of each resource: in approved receptions. */
export function recibidoPorInsumo(recepciones: Recepcion[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of recepciones) {
    if (r.estado !== "aprobada") continue;
    for (const l of r.lineas) out.set(l.insumoId, redondear((out.get(l.insumoId) ?? 0) + l.aceptado, 4));
  }
  return out;
}

/** The issued orders (and any order with receptions) as the people who receive see them, with what is pending. */
export function ordenesPorRecibir(ordenes: Orden[], recepciones: Recepcion[], proveedores: Proveedor[]): OrdenPorRecibir[] {
  return ordenes
    .filter((o) => o.estado === "aprobada" || tieneRecepciones(recepciones, o.id))
    .map((o) => {
      const p = proveedores.find((x) => x.id === o.proveedorId);
      const suyas = recepciones.filter((r) => r.ordenId === o.id && r.estado !== "anulada");
      const suma = (rl: string, campo: "aceptado" | "rechazado" | "devuelto", estados: EstadoRecepcion[]) =>
        redondear(
          suyas.filter((r) => estados.includes(r.estado)).reduce((s, r) => s + r.lineas.filter((l) => l.requisicionLineaId === rl).reduce((x, l) => x + l[campo], 0), 0),
          4
        );
      return {
        id: o.id,
        tipo: o.tipo,
        numero: o.numero,
        revision: o.revision,
        estado: o.estado,
        proveedor: p?.razonSocial ?? "",
        nit: p ? nitConDv(p.nit, p.dv) : "",
        fechaEntrega: o.fechaEntrega,
        lugarEntrega: o.lugarEntrega,
        lineas: o.lineas.map((l) => {
          const aceptado = suma(l.requisicionLineaId, "aceptado", ["aprobada"]);
          const enTramite = suma(l.requisicionLineaId, "aceptado", ["borrador", "enviada"]);
          return {
            requisicionLineaId: l.requisicionLineaId,
            insumoId: l.insumoId,
            codigo: l.codigo,
            descripcion: l.descripcion,
            unidad: l.unidad,
            tipo: l.tipo,
            ordenado: l.cantidad,
            aceptado,
            enTramite,
            rechazado: suma(l.requisicionLineaId, "rechazado", ["aprobada"]),
            devuelto: suma(l.requisicionLineaId, "devuelto", ["aprobada"]),
            pendiente: Math.max(0, redondear(l.cantidad - aceptado - enTramite, 4)),
          };
        }),
      };
    });
}

/** How an order stands in receiving: nothing, partial or complete (by approved receptions). */
export function avanceRecepcion(o: OrdenPorRecibir): { estado: "sin-recibir" | "parcial" | "completa"; pct: number } {
  const ordenado = o.lineas.reduce((s, l) => s + l.ordenado, 0);
  const aceptado = o.lineas.reduce((s, l) => s + Math.min(l.aceptado, l.ordenado), 0);
  const pct = ordenado > 0 ? redondear((aceptado / ordenado) * 100, 2) : 0;
  const completa = o.lineas.every((l) => l.aceptado >= l.ordenado);
  return { estado: completa ? "completa" : aceptado > 0 ? "parcial" : "sin-recibir", pct };
}

export function puedeEditarRecepcion(r: Pick<Recepcion, "estado" | "elaboradoPorId">, actorId: string, permisos: readonly Permiso[]): boolean {
  return r.estado === "borrador" && (tiene(permisos, "recepciones", "editar") || (r.elaboradoPorId === actorId && tiene(permisos, "recepciones", "crear")));
}

export interface ContextoRecepciones {
  actorId: string;
  permisos: readonly Permiso[];
  hoy: string;
}

/** Why this draft can't be saved (null: it can). */
export function revisarRecepcion(ctx: ContextoRecepciones, c: CambioRecepcion, antes: Recepcion | null, orden: Orden | undefined, recepciones: Recepcion[]): MotivoRechazo | null {
  if (antes) {
    if (antes.ordenId !== c.ordenId) return "datos";
    if (antes.estado !== "borrador") return "estado-no-valido";
    if (!puedeEditarRecepcion(antes, ctx.actorId, ctx.permisos)) return "sin-permiso";
  } else if (!tiene(ctx.permisos, "recepciones", "crear")) return "sin-permiso";
  if (!orden) return "no-existe";
  if (orden.estado !== "aprobada") return "orden-no-emitida";
  if (c.fecha > ctx.hoy) return "fecha-futura";
  if (!c.lineas.length) return "sin-lineas";
  const otros = aceptadoPorLinea(recepciones, antes?.id);
  const vistas = new Set<string>();
  for (const l of c.lineas) {
    const ol = orden.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId);
    if (!ol || vistas.has(l.requisicionLineaId)) return "datos";
    vistas.add(l.requisicionLineaId);
    if (!(l.recibido > 0)) return "cantidad-no-valida";
    if (l.rechazado < 0 || l.rechazado > l.recibido || l.devuelto < 0 || l.devuelto > l.rechazado || (l.rechazado > 0 && !l.motivo.trim())) return "rechazo-no-valido";
    const aceptado = redondear(l.recibido - l.rechazado, 4);
    if (redondear((otros.get(clave(orden.id, l.requisicionLineaId)) ?? 0) + aceptado, 4) > ol.cantidad) return "recepcion-excedida";
  }
  if ((antes?.version ?? 0) !== c.version) return "version-conflict";
  return null;
}

/** Can the caller try this action now (state and permission), for the screen's buttons. */
export function puedeAccionRecepcion(ctx: Pick<ContextoRecepciones, "actorId" | "permisos">, r: Recepcion, accion: AccionRecepcion): boolean {
  if (!TRANSICIONES_RECEPCION[accion].desde.includes(r.estado)) return false;
  if (accion === "enviar") return puedeEditarRecepcion(r, ctx.actorId, ctx.permisos);
  if (accion === "aprobar" || accion === "devolver") return tiene(ctx.permisos, "recepciones", "aprobar") && r.elaboradoPorId !== ctx.actorId;
  return tiene(ctx.permisos, "recepciones", "anular");
}

/** Why `a` can't be done to the reception now (null: it can). */
export function revisarAccionRecepcion(ctx: ContextoRecepciones, r: Recepcion, a: AccionSobreRecepcion, orden: Orden | undefined): MotivoRechazo | null {
  if (!TRANSICIONES_RECEPCION[a.accion].desde.includes(r.estado)) return "estado-no-valido";
  const permitido =
    a.accion === "enviar"
      ? puedeEditarRecepcion(r, ctx.actorId, ctx.permisos)
      : a.accion === "aprobar" || a.accion === "devolver"
        ? tiene(ctx.permisos, "recepciones", "aprobar")
        : tiene(ctx.permisos, "recepciones", "anular");
  if (!permitido) return "sin-permiso";
  if ((a.accion === "aprobar" || a.accion === "devolver") && r.elaboradoPorId === ctx.actorId) return "auto-aprobacion";
  if (CON_MOTIVO.includes(a.accion) && !a.motivo.trim()) return "motivo-requerido";
  if (r.version !== a.version) return "version-conflict";
  if ((a.accion === "enviar" || a.accion === "aprobar") && orden?.estado !== "aprobada") return "orden-no-emitida";
  return null;
}
