import { clienteSupabase, eq, faltaTabla } from "../compras/supabase";
import { StoreError } from "../propiedades/store";
import type { ColumnaMemoria, Medicion, Memoria, ResumenItem } from "../presupuesto/types";

/**
 * Read-only access to the budget of Presupuesto, the only source of the
 * planned resources, quantities and prices. Compras and Control de Obra never
 * write in the presupuesto_* tables: this module can only send GET requests.
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
  /** The model elements linked to one partida, with the quantity the model gives each and its memoria. */
  elementosDePartida(projectId: string, itemId: string): Promise<ElementoPresupuesto[]>;
  /** The columns of the memoria de cantidades chosen in Presupuesto (null: the default ones). */
  columnasMemoria(projectId: string): Promise<ColumnaMemoria[] | null>;
  /** The saved schedule (with its EDT, when there is one). */
  programacion(projectId: string): Promise<{ data: unknown; version: number } | null>;
}

/** An element linked to a partida in Presupuesto (model_id is the model's file id). */
export interface ElementoPresupuesto {
  ifcGuid: string;
  modelId: string;
  cantidad: number | null;
  memoria: Memoria | null;
}

const SIN_PRESUPUESTO =
  "No se encontraron las tablas de Presupuesto en Supabase: Compras y Control de Obra leen el presupuesto, así que primero debe estar instalada la extensión Presupuesto (supabase/presupuesto.sql).";

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
    async elementosDePartida(projectId, itemId) {
      const rows = await leerTodo<{ ifc_guid: string; model_id: string; cantidad: number | string | null; memoria: Memoria | null }>(
        `/presupuesto_elementos?project_id=${eq(projectId)}&item_id=${eq(itemId)}&select=ifc_guid,model_id,cantidad,memoria&order=id.asc`
      );
      return rows.map((r) => ({ ifcGuid: r.ifc_guid, modelId: r.model_id, cantidad: r.cantidad === null ? null : Number(r.cantidad), memoria: r.memoria }));
    },
    async columnasMemoria(projectId) {
      const rows = await leer<{ memoria_columnas: ColumnaMemoria[] | null }[]>(`/presupuesto_config?project_id=${eq(projectId)}&select=memoria_columnas`);
      return rows[0]?.memoria_columnas ?? null;
    },
    async programacion(projectId) {
      const rows = await leer<{ data: unknown; version: number }[]>(`/presupuesto_programacion?project_id=${eq(projectId)}&select=data,version`);
      return rows[0] ?? null;
    },
  };
}

/** Fixed data, for tests and for `next dev` without a database. */
export function memoriaLectura(
  datos: Record<
    string,
    {
      documento?: DocumentoPresupuesto;
      mediciones?: Medicion[];
      resumen?: ResumenItem[];
      /** By partida id. */
      elementos?: Record<string, ElementoPresupuesto[]>;
      columnas?: ColumnaMemoria[] | null;
      programacion?: { data: unknown; version: number } | null;
    }
  > = {}
): LecturaPresupuesto {
  return {
    documento: async (p) => (datos[p]?.documento ? structuredClone(datos[p].documento) : null),
    mediciones: async (p) => structuredClone(datos[p]?.mediciones ?? []),
    resumenElementos: async (p) => structuredClone(datos[p]?.resumen ?? []),
    elementosDePartida: async (p, itemId) => structuredClone(datos[p]?.elementos?.[itemId] ?? []),
    columnasMemoria: async (p) => structuredClone(datos[p]?.columnas ?? null),
    programacion: async (p) => structuredClone(datos[p]?.programacion ?? null),
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
