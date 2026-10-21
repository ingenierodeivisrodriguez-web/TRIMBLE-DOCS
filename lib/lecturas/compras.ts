import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { TipoInsumo } from "../presupuesto/types";

/**
 * Read-only access to Compras for Control de Obra: the approved contracts
 * (subcontracts and labor) with their lines. Control de Obra never writes in
 * the compras_* tables: this module can only send GET requests. Without
 * Compras installed there are simply no contracts (work by own crews).
 */

export interface LineaContrato {
  /** Stable across the contract's revisions (the order lines are rewritten when it is saved). */
  requisicionLineaId: string;
  insumoId: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  ivaPct: number;
  /** The budget partida the requisition line was for, when it said so. */
  partidaItemId: string | null;
}

export interface ContratoCompras {
  id: string;
  /** CT-0001 */
  numero: number;
  revision: number;
  proveedorId: string;
  proveedor: string;
  /** "900123456-8" (or "" if the supplier has none). */
  nit: string;
  anticipoPct: number;
  retencionGarantiaPct: number;
  /** When it was approved (issued). */
  aprobada: string | null;
  lineas: LineaContrato[];
}

export interface LecturaCompras {
  /** The project's approved contracts (not orders, not drafts nor cancelled ones). */
  contratos(projectId: string): Promise<ContratoCompras[]>;
}

class SinCompras extends Error {}

const LOTE = 100;
const lotes = <T,>(l: T[]) => Array.from({ length: Math.ceil(l.length / LOTE) }, (_, i) => l.slice(i * LOTE, (i + 1) * LOTE));
const enLista = (ids: string[]) => `in.(${ids.map((x) => encodeURIComponent(x)).join(",")})`;

export function supabaseCompras(): LecturaCompras | null {
  const db = clienteSupabase((_status, body) => (faltaTabla(body) ? new SinCompras() : null));
  if (!db) return null;
  // Only ever GET.
  const leerTodo = <T,>(path: string) => db.all<T>(path);
  return {
    async contratos(projectId) {
      try {
        const ordenes = await leerTodo<{
          id: string;
          numero: number;
          revision: number;
          proveedor_id: string;
          anticipo_pct: number | string;
          retencion_garantia_pct: number | string;
          aprobada: string | null;
        }>(
          `/compras_ordenes?project_id=${eq(projectId)}&tipo=eq.contrato&estado=eq.aprobada&select=id,numero,revision,proveedor_id,anticipo_pct,retencion_garantia_pct,aprobada&order=numero.asc`
        );
        if (!ordenes.length) return [];
        const lineas: {
          orden_id: string;
          requisicion_linea_id: string;
          insumo_id: string;
          codigo: string;
          descripcion: string;
          unidad: string;
          tipo: TipoInsumo;
          cantidad: number | string;
          precio_unitario: number | string;
          descuento_pct: number | string;
          iva_pct: number | string;
        }[] = [];
        for (const l of lotes(ordenes.map((o) => o.id))) {
          lineas.push(
            ...(await leerTodo<(typeof lineas)[number]>(
              `/compras_orden_lineas?project_id=${eq(projectId)}&orden_id=${enLista(l)}&select=orden_id,requisicion_linea_id,insumo_id,codigo,descripcion,unidad,tipo,cantidad,precio_unitario,descuento_pct,iva_pct&order=id.asc`
            ))
          );
        }
        const partidas = new Map<string, string | null>();
        for (const l of lotes([...new Set(lineas.map((x) => x.requisicion_linea_id))])) {
          for (const r of await leerTodo<{ id: string; partida_item_id: string | null }>(`/compras_requisicion_lineas?project_id=${eq(projectId)}&id=${enLista(l)}&select=id,partida_item_id`)) {
            partidas.set(r.id, r.partida_item_id);
          }
        }
        const proveedores = new Map<string, { nit: string; dv: number | null; razon_social: string }>();
        for (const l of lotes([...new Set(ordenes.map((o) => o.proveedor_id))])) {
          for (const r of await leerTodo<{ id: string; nit: string; dv: number | null; razon_social: string }>(`/compras_proveedores?project_id=${eq(projectId)}&id=${enLista(l)}&select=id,nit,dv,razon_social`)) {
            proveedores.set(r.id, r);
          }
        }
        return ordenes.map((o) => {
          const p = proveedores.get(o.proveedor_id);
          return {
            id: o.id,
            numero: o.numero,
            revision: o.revision,
            proveedorId: o.proveedor_id,
            proveedor: p?.razon_social ?? "",
            nit: p?.nit ? `${p.nit}${p.dv === null ? "" : `-${p.dv}`}` : "",
            anticipoPct: Number(o.anticipo_pct),
            retencionGarantiaPct: Number(o.retencion_garantia_pct),
            aprobada: o.aprobada,
            lineas: lineas
              .filter((l) => l.orden_id === o.id)
              .map((l) => ({
                requisicionLineaId: l.requisicion_linea_id,
                insumoId: l.insumo_id,
                codigo: l.codigo,
                descripcion: l.descripcion,
                unidad: l.unidad,
                tipo: l.tipo,
                cantidad: Number(l.cantidad),
                precioUnitario: Number(l.precio_unitario),
                descuentoPct: Number(l.descuento_pct),
                ivaPct: Number(l.iva_pct),
                partidaItemId: partidas.get(l.requisicion_linea_id) ?? null,
              })),
          };
        });
      } catch (err) {
        if (err instanceof SinCompras) return [];
        throw err;
      }
    },
  };
}

/** Fixed data, for tests and for `next dev` without a database. */
export function memoriaCompras(datos: Record<string, ContratoCompras[]> = {}): LecturaCompras {
  return { contratos: async (p) => structuredClone(datos[p] ?? []) };
}

let selected: LecturaCompras | null | undefined;
let dev: LecturaCompras | undefined;

export function lecturaCompras(): LecturaCompras {
  if (selected === undefined) selected = supabaseCompras();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") throw new StoreError("La base de datos no está conectada (Supabase).");
  return (dev ??= memoriaCompras());
}
