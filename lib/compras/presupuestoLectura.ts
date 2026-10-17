import { StoreError } from "../propiedades/store";
import type { Medicion, ResumenItem } from "../presupuesto/types";
import { clienteSupabase, eq, faltaTabla } from "./supabase";

/**
 * Read-only access to the budget of Presupuesto, the only source of the
 * planned resources, quantities and prices. Compras never writes in the
 * presupuesto_* tables: this module can only send GET requests.
 */
export interface DocumentoPresupuesto {
  data: unknown;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface LecturaPresupuesto {
  documento(projectId: string): Promise<DocumentoPresupuesto | null>;
  /** How each partida takes its quantity from the model (field or element count). */
  mediciones(projectId: string): Promise<Medicion[]>;
  /** Elements linked to each partida and the sum of their quantities. */
  resumenElementos(projectId: string): Promise<ResumenItem[]>;
}

const SIN_PRESUPUESTO =
  "No se encontraron las tablas de Presupuesto en Supabase: Compras lee los insumos del presupuesto, así que primero debe estar instalada la extensión Presupuesto (supabase/presupuesto.sql).";

export function supabaseLectura(): LecturaPresupuesto | null {
  const db = clienteSupabase((_status, body) => (faltaTabla(body) ? new StoreError(SIN_PRESUPUESTO) : null));
  if (!db) return null;
  // Only ever GET.
  const leer = <T>(path: string) => db.json<T>(path);
  const leerTodo = <T>(path: string) => db.all<T>(path);
  return {
    async documento(projectId) {
      const rows = await leer<{ data: unknown; version: number; updated_at: string | null; updated_by: string | null }[]>(
        `/presupuesto_documentos?project_id=${eq(projectId)}&select=data,version,updated_at,updated_by`
      );
      const r = rows[0];
      return r ? { data: r.data, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
    },
    async mediciones(projectId) {
      const rows = await leerTodo<{ item_id: string; campo: string | null; campo_label: string; unidad: string }>(
        `/presupuesto_mediciones?project_id=${eq(projectId)}&select=item_id,campo,campo_label,unidad&order=item_id.asc`
      );
      return rows.map((r) => ({ itemId: r.item_id, campo: r.campo, campoLabel: r.campo_label, unidad: r.unidad }));
    },
    async resumenElementos(projectId) {
      const rows = await leerTodo<{ item_id: string; elementos: number | string; suma: number | string }>(
        `/presupuesto_resumen_elementos?project_id=${eq(projectId)}&select=item_id,elementos,suma&order=item_id.asc`
      );
      return rows.map((r) => ({ itemId: r.item_id, elementos: Number(r.elementos), suma: Number(r.suma) }));
    },
  };
}

/** Fixed data, for tests and for `next dev` without a database. */
export function memoriaLectura(datos: Record<string, { documento?: DocumentoPresupuesto; mediciones?: Medicion[]; resumen?: ResumenItem[] }> = {}): LecturaPresupuesto {
  return {
    documento: async (p) => (datos[p]?.documento ? structuredClone(datos[p].documento) : null),
    mediciones: async (p) => structuredClone(datos[p]?.mediciones ?? []),
    resumenElementos: async (p) => structuredClone(datos[p]?.resumen ?? []),
  };
}

let selected: LecturaPresupuesto | null | undefined;
let dev: LecturaPresupuesto | undefined;

export function lecturaPresupuesto(): LecturaPresupuesto {
  if (selected === undefined) selected = supabaseLectura();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") throw new StoreError("La base de datos no está conectada (Supabase).");
  return (dev ??= memoriaLectura());
}
