import type { MetradoModelo } from "../presupuesto/calc";
import { CONTEO, Medicion, PresupuestoDoc, ResumenItem } from "../presupuesto/types";

/**
 * A partida's quantity from the model: the sum of its elements' quantities
 * (or how many there are, for a count), unless the partida was set to
 * "manual". The same rule as the budget screen (usePresupuesto + PresupuestoApp).
 */
export function metradosDelModelo(doc: PresupuestoDoc, mediciones: Medicion[], resumen: ResumenItem[]): Map<string, MetradoModelo> {
  const sumas = new Map(resumen.map((r) => [r.itemId, r]));
  const out = new Map<string, MetradoModelo>();
  for (const m of mediciones) {
    const r = sumas.get(m.itemId);
    if (!m.campo || !r || r.elementos === 0) continue;
    out.set(m.itemId, { valor: m.campo === CONTEO ? r.elementos : r.suma, elementos: r.elementos, campoLabel: m.campoLabel });
  }
  for (const sp of doc.subpresupuestos) for (const i of sp.items) if (i.tipo === "partida" && i.modo === "manual") out.delete(i.id);
  return out;
}

/** A stored budget that doesn't look like one (should not happen: Presupuesto validates what it saves). */
export function esDocumento(data: unknown): data is PresupuestoDoc {
  const d = data as Partial<PresupuestoDoc> | null;
  return !!d && Array.isArray(d.subpresupuestos) && !!d.insumos && typeof d.insumos === "object" && !!d.subpartidas && typeof d.subpartidas === "object";
}
