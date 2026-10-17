import { ApuCalculado, consumoDeApu, listaInsumos, MetradoModelo, redondear } from "../presupuesto/calc";
import { resolverPresupuesto } from "../presupuesto/doc";
import { numerar } from "../presupuesto/tree";
import { CONTEO, Medicion, PresupuestoDoc, ResumenItem, TipoInsumo } from "../presupuesto/types";
import type { InsumoPlanificado, InsumosResponse, UsoInsumo, ViaCompra } from "./types";

/**
 * The planned resources of a project, computed from its budget exactly as
 * Presupuesto's "Lista de insumos" does (with the pure functions of
 * lib/presupuesto, never changing them), plus where each one is used.
 */

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

/** Materials and equipment go by purchase order; subcontracts and labor by contract. */
export function viaCompra(tipo: TipoInsumo): ViaCompra {
  return tipo === "MT" || tipo === "EQ" ? "orden" : "contrato";
}

/** A stored budget that doesn't look like one (should not happen: Presupuesto validates what it saves). */
export function esDocumento(data: unknown): data is PresupuestoDoc {
  const d = data as Partial<PresupuestoDoc> | null;
  return !!d && Array.isArray(d.subpresupuestos) && !!d.insumos && typeof d.insumos === "object" && !!d.subpartidas && typeof d.subpartidas === "object";
}

export function insumosPlanificados(doc: PresupuestoDoc, metrados: Map<string, MetradoModelo>): Pick<InsumosResponse, "insumos" | "porcentaje"> {
  const r = resolverPresupuesto(doc);
  const metradoModelo = (id: string) => metrados.get(id) ?? null;
  const filas = listaInsumos(doc.subpresupuestos, r, metradoModelo);

  // Where each resource is used, partida by partida.
  const usos = new Map<string, UsoInsumo[]>();
  const cache = new Map<string, ApuCalculado>();
  for (const sp of doc.subpresupuestos) {
    const numeros = numerar(sp.items);
    sp.items.forEach((item, index) => {
      if (item.tipo !== "partida") return;
      const modelo = metradoModelo(item.id);
      const metrado = redondear(modelo ? modelo.valor : item.metrado, 2);
      const consumo = consumoDeApu(item, metrado, r, cache);
      for (const [id, cantidad] of consumo.cantidades) {
        const lista = usos.get(id) ?? [];
        lista.push({
          itemId: item.id,
          subpresupuesto: sp.nombre,
          numero: numeros[index],
          descripcion: item.descripcion,
          unidad: item.unidad,
          metrado,
          desdeModelo: !!modelo,
          cantidad: redondear(cantidad, 4),
        });
        usos.set(id, lista);
      }
    });
  }

  const insumos: InsumoPlanificado[] = filas
    .filter((f) => !f.porcentaje)
    .map((f) => ({
      id: f.id,
      codigo: doc.insumos[f.id]?.codigo ?? "",
      descripcion: f.descripcion,
      unidad: f.unidad,
      tipo: f.tipo,
      precio: f.precio,
      cantidad: f.cantidad,
      monto: f.parcial,
      via: viaCompra(f.tipo),
      usos: usos.get(f.id) ?? [],
    }));
  const porcentaje = filas.filter((f) => f.porcentaje).map((f) => ({ id: f.id, descripcion: f.descripcion, monto: f.parcial }));
  return { insumos, porcentaje };
}
