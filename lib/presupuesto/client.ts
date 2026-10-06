import { createRequester, TokenSource } from "../propiedades/client";
import type { ProjectContacts, Responsable } from "../propiedades/types";
import {
  CatalogoResponse,
  DocumentoResponse,
  ElementoVinculado,
  EstadoResponse,
  InsumoData,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_IMPORT_ROWS,
  Medicion,
  OmniclassEntry,
  PartidaData,
  PresupuestoDoc,
  ResumenElementos,
} from "./types";

/** What the budget screen and the 3D viewer panel need from the data service. */
export interface PresupuestoApi {
  getEstado(): Promise<EstadoResponse>;
  updateConfig(patch: { baseProjectId?: string | null; editores?: Responsable[] }): Promise<EstadoResponse>;
  getContacts(): Promise<ProjectContacts>;
  getCatalogo(): Promise<CatalogoResponse>;
  /** Creates or updates; several requests when there are many (`onProgress` after each). */
  guardarInsumos(rows: (InsumoData & { id: string })[], onProgress?: (done: number) => void): Promise<number>;
  eliminarInsumo(id: string): Promise<void>;
  guardarPartidas(rows: (PartidaData & { id: string })[], onProgress?: (done: number) => void): Promise<number>;
  eliminarPartida(id: string): Promise<void>;
  guardarOmniclass(entradas: OmniclassEntry[]): Promise<number>;
  getDocumento(): Promise<DocumentoResponse>;
  guardarDocumento(doc: PresupuestoDoc, version: number): Promise<{ version: number }>;
  getResumen(): Promise<ResumenElementos>;
  elementosDe(filter: { itemIds?: string[]; ifcGuids?: string[] }): Promise<ElementoVinculado[]>;
  guardarElementos(
    itemId: string,
    upsert: { ifcGuid: string; modelId: string; cantidad: number | null }[],
    remove: string[]
  ): Promise<void>;
  guardarMedicion(medicion: Medicion): Promise<void>;
}

export function presupuestoApi(projectId: string, auth: TokenSource): PresupuestoApi {
  const request = createRequester("/api/presupuesto", projectId, auth);
  const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

  async function inBatches<T>(rows: T[], size: number, save: (batch: T[]) => Promise<number>, onProgress?: (done: number) => void) {
    let saved = 0;
    for (let i = 0; i < rows.length; i += size) {
      saved += await save(rows.slice(i, i + size));
      onProgress?.(Math.min(i + size, rows.length));
    }
    return saved;
  }

  return {
    getEstado: () => request("/estado"),
    updateConfig: (patch) => request("/config", send("PUT", patch)),
    getContacts: () => request("/contactos"),
    getCatalogo: () => request("/catalogo"),
    guardarInsumos: (rows, onProgress) =>
      inBatches(
        rows,
        MAX_IMPORT_ROWS,
        (insumos) => request<{ guardados: number }>("/catalogo/insumos", send("POST", { insumos })).then((r) => r.guardados),
        onProgress
      ),
    async eliminarInsumo(id) {
      await request(`/catalogo/insumos/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    guardarPartidas: (rows, onProgress) =>
      inBatches(
        rows,
        400,
        (partidas) => request<{ guardados: number }>("/catalogo/partidas", send("POST", { partidas })).then((r) => r.guardados),
        onProgress
      ),
    async eliminarPartida(id) {
      await request(`/catalogo/partidas/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    guardarOmniclass: (entradas) =>
      inBatches(entradas, 5000, (batch) =>
        request<{ guardados: number }>("/catalogo/omniclass", send("POST", { entradas: batch })).then((r) => r.guardados)
      ),
    getDocumento: () => request("/documento"),
    guardarDocumento: (doc, version) => request("/documento", send("PUT", { doc, version })),
    getResumen: () => request("/elementos/resumen"),
    async elementosDe(filter) {
      const out: ElementoVinculado[] = [];
      const ask = async (body: { itemIds?: string[]; ifcGuids?: string[] }) =>
        out.push(...(await request<{ elementos: ElementoVinculado[] }>("/elementos/consulta", send("POST", body))).elementos);
      const items = filter.itemIds ?? [];
      const guids = filter.ifcGuids ?? [];
      for (let i = 0; i < items.length; i += MAX_ELEMENTS_PER_REQUEST) await ask({ itemIds: items.slice(i, i + MAX_ELEMENTS_PER_REQUEST) });
      for (let i = 0; i < guids.length; i += MAX_ELEMENTS_PER_REQUEST) await ask({ ifcGuids: guids.slice(i, i + MAX_ELEMENTS_PER_REQUEST) });
      return out;
    },
    async guardarElementos(itemId, upsert, remove) {
      const n = MAX_ELEMENTS_PER_REQUEST;
      for (let i = 0; i < Math.max(upsert.length, remove.length); i += n) {
        await request("/elementos", send("PUT", { itemId, upsert: upsert.slice(i, i + n), remove: remove.slice(i, i + n) }));
      }
    },
    async guardarMedicion(medicion) {
      await request("/mediciones", send("PUT", medicion));
    },
  };
}
