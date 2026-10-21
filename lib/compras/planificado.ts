import { esDocumento, metradosDelModelo } from "../lecturas/metrado";
import { ApuCalculado, consumoDeApu, listaInsumos, MetradoModelo, redondear } from "../presupuesto/calc";
import { resolverPresupuesto } from "../presupuesto/doc";
import { numerar } from "../presupuesto/tree";
import { PresupuestoDoc, TipoInsumo } from "../presupuesto/types";
import type { InsumoPlanificado, InsumosResponse, UsoInsumo, ViaCompra } from "./types";

/**
 * The planned resources of a project, computed from its budget exactly as
 * Presupuesto's "Lista de insumos" does (with the pure functions of
 * lib/presupuesto, never changing them), plus where each one is used.
 */

export { esDocumento, metradosDelModelo };

/** Materials and equipment go by purchase order; subcontracts and labor by contract. */
export function viaCompra(tipo: TipoInsumo): ViaCompra {
  return tipo === "MT" || tipo === "EQ" ? "orden" : "contrato";
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
      solicitado: 0,
      aprobado: 0,
      comprometido: 0,
      recibido: 0,
    }));
  const porcentaje = filas.filter((f) => f.porcentaje).map((f) => ({ id: f.id, descripcion: f.descripcion, monto: f.parcial }));
  return { insumos, porcentaje };
}
