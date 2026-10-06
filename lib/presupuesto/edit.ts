// Small immutable updates of a budget document.
import { nuevoId } from "./doc";
import type { Item, ItemPartida, PresupuestoDoc, Subpresupuesto } from "./types";

export function conSubpresupuesto(doc: PresupuestoDoc, spId: string, change: (sp: Subpresupuesto) => Subpresupuesto): PresupuestoDoc {
  return { ...doc, subpresupuestos: doc.subpresupuestos.map((sp) => (sp.id === spId ? change(sp) : sp)) };
}

export function conItem(doc: PresupuestoDoc, spId: string, itemId: string, change: (item: Item) => Item): PresupuestoDoc {
  return conSubpresupuesto(doc, spId, (sp) => ({ ...sp, items: sp.items.map((i) => (i.id === itemId ? change(i) : i)) }));
}

export function conPartida(doc: PresupuestoDoc, spId: string, itemId: string, change: (item: ItemPartida) => ItemPartida): PresupuestoDoc {
  return conItem(doc, spId, itemId, (i) => (i.tipo === "partida" ? change(i) : i));
}

/** A copy of rows with new ids (pasting a copy must not share ids with the original). */
export function clonarBloque(items: Item[]): Item[] {
  return items.map((i) => (i.tipo === "partida" ? { ...i, id: nuevoId(), componentes: i.componentes.map((c) => ({ ...c })) } : { ...i, id: nuevoId() }));
}

/** Where a row is: its subpresupuesto and index. */
export function ubicar(doc: PresupuestoDoc, itemId: string): { sp: Subpresupuesto; index: number } | null {
  for (const sp of doc.subpresupuestos) {
    const index = sp.items.findIndex((i) => i.id === itemId);
    if (index >= 0) return { sp, index };
  }
  return null;
}
