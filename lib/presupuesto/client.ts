import { createRequester, TokenSource } from "../propiedades/client";
import type {
  BorradorApuIA,
  BorradorEstructuraIA,
  BorradorIA,
  BorradorInsumoIA,
  CapituloIA,
  CupoGlobalIA,
  CupoIA,
  EstadoCupo,
  EstadoIAResponse,
  GenerarApuResponse,
  GenerarEdtResponse,
  GenerarInsumosResponse,
  InsumoCatalogoIA,
  MensajeChatIA,
  PartidaApuIA,
  PartidaCatalogoIA,
  PartidaEdtIA,
  PartidaInsumosIA,
  PeticionEstructura,
  RespuestaChatIA,
  ResumenesIA,
} from "./ia/tipos";
import type { ProjectContacts, Responsable } from "../propiedades/types";
import {
  AtributoPropiedad,
  CampoModelo,
  CamposModelo,
  CatalogoResponse,
  ElementoRef,
  VistaPendiente,
  ColumnaMemoria,
  DocumentoResponse,
  ElementoVinculado,
  EstadoResponse,
  InsumoData,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_IMPORT_ROWS,
  Memoria,
  Medicion,
  OmniclassEntry,
  PartidaData,
  PresupuestoDoc,
  Programacion,
  ProgramacionResponse,
  ResumenElementos,
} from "./types";

/** What the budget screen and the 3D viewer panel need from the data service. */
export interface PresupuestoApi {
  getEstado(): Promise<EstadoResponse>;
  updateConfig(patch: { baseProjectId?: string | null; editores?: Responsable[]; memoriaColumnas?: ColumnaMemoria[] }): Promise<EstadoResponse>;
  /** Attributes of the Propiedades app, to choose as columns of the memoria de cantidades. */
  getAtributos(): Promise<{ atributos: AtributoPropiedad[]; modelo: CamposModelo | null }>;
  /** Leaves the elements to see in 3D for this user's viewer panel. */
  pedirVista(itemId: string, elementos: ElementoRef[]): Promise<void>;
  /** Asks the viewer panel to update the memoria of every partida; answers the model to open the viewer with. */
  pedirActualizacionMemoria(): Promise<{ modelId: string; modelos: number; elementos: number }>;
  /** The elements this user asked to see in 3D (once), or null. */
  tomarVista(): Promise<VistaPendiente | null>;
  /** Saves the properties of the models loaded in the viewer. */
  guardarCamposModelo(data: { modelos: string[]; campos: CampoModelo[] }): Promise<number>;
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
  getEstadoIA(): Promise<EstadoIAResponse>;
  guardarCupoIA(patch: { proyecto?: CupoIA; otro?: { proyecto: string; cupo: CupoIA }; global?: CupoGlobalIA }): Promise<EstadoIAResponse>;
  generarEdtIA(contexto: string, partidas: PartidaEdtIA[]): Promise<GenerarEdtResponse>;
  borradoresIA(): Promise<BorradorIA[]>;
  borradoresEstructuraIA(): Promise<BorradorEstructuraIA[]>;
  borradoresInsumosIA(): Promise<BorradorInsumoIA[]>;
  /** Records what was accepted (with what was applied, `final`), edited or rejected. */
  decidirBorradoresIA(decisiones: { id: string; estado: "aceptado" | "rechazado"; final?: unknown }[]): Promise<{ decididos: number; resumen: ResumenesIA }>;
  proponerCapitulosIA(p: PeticionEstructura): Promise<{ capitulos: CapituloIA[]; costoCop: number; cupo: EstadoCupo }>;
  proponerPartidasIA(
    p: PeticionEstructura & { capitulo: CapituloIA; otros: string[]; catalogo: PartidaCatalogoIA[] }
  ): Promise<{ borrador: BorradorEstructuraIA; costoCop: number; cupo: EstadoCupo }>;
  generarInsumosIA(contexto: string, partidas: PartidaInsumosIA[], catalogo: InsumoCatalogoIA[]): Promise<GenerarInsumosResponse>;
  /** The analysis of a batch of partidas; with `evaluar`, nothing is saved (to compare with the catalog). */
  generarApuIA(p: { contexto: string; partidas: PartidaApuIA[]; catalogo: InsumoCatalogoIA[]; evaluar?: boolean }): Promise<GenerarApuResponse>;
  borradoresApuIA(): Promise<BorradorApuIA[]>;
  /** A question about the open budget, sent as text. */
  chatIA(p: { pregunta: string; contexto: string; historial: MensajeChatIA[] }): Promise<RespuestaChatIA>;
  getProgramacion(): Promise<ProgramacionResponse>;
  guardarProgramacion(programacion: Programacion, version: number): Promise<{ version: number }>;
  getResumen(): Promise<ResumenElementos>;
  elementosDe(filter: { itemIds?: string[]; ifcGuids?: string[] }): Promise<ElementoVinculado[]>;
  guardarElementos(
    itemId: string,
    upsert: { ifcGuid: string; modelId: string; cantidad: number | null; memoria: Memoria | null }[],
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
    getAtributos: () => request("/atributos"),
    async pedirVista(itemId, elementos) {
      await request("/vista", send("PUT", { itemId, elementos }));
    },
    pedirActualizacionMemoria: () => request("/memoria", send("POST", {})),
    tomarVista: () => request<{ vista: VistaPendiente | null }>("/vista").then((r) => r.vista),
    guardarCamposModelo: (data) => request<{ guardadas: number }>("/campos-modelo", send("PUT", data)).then((r) => r.guardadas),
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
    getEstadoIA: () => request("/ia"),
    guardarCupoIA: (patch) => request("/ia/cupo", send("PUT", patch)),
    generarEdtIA: (contexto, partidas) => request("/ia/edt", send("POST", { contexto, partidas })),
    borradoresIA: () => request<{ borradores: BorradorIA[] }>("/ia/borradores?tarea=edt").then((r) => r.borradores),
    borradoresEstructuraIA: () => request<{ borradores: BorradorEstructuraIA[] }>("/ia/borradores?tarea=estructura").then((r) => r.borradores),
    borradoresInsumosIA: () => request<{ borradores: BorradorInsumoIA[] }>("/ia/borradores?tarea=insumos").then((r) => r.borradores),
    proponerCapitulosIA: (p) => request("/ia/estructura/capitulos", send("POST", p)),
    proponerPartidasIA: (p) => request("/ia/estructura/partidas", send("POST", p)),
    generarInsumosIA: (contexto, partidas, catalogo) => request("/ia/insumos", send("POST", { contexto, partidas, catalogo })),
    generarApuIA: (p) => request("/ia/apu", send("POST", p)),
    borradoresApuIA: () => request<{ borradores: BorradorApuIA[] }>("/ia/borradores?tarea=apu").then((r) => r.borradores),
    chatIA: (p) => request("/ia/chat", send("POST", p)),
    decidirBorradoresIA: (decisiones) => request("/ia/borradores", send("PUT", { decisiones })),
    getProgramacion: () => request("/programacion"),
    guardarProgramacion: (programacion, version) => request("/programacion", send("PUT", { programacion, version })),
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
