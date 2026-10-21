import { ApiError, TokenSource } from "../propiedades/client";
import { expiresSoon } from "../propiedades/token";
import type { ProjectContacts, Responsable } from "../propiedades/types";
import { aGuardar } from "./auditoria";
import type { ConVersion, NuevaExcepcion } from "./store";
import {
  Auditoria,
  Excepcion,
  InformeAuditoria,
  LoteAuditoria,
  MAX_LOTES_POR_ENVIO,
  CamposModelo,
  MAX_ASOCIACIONES_POR_ENVIO,
  ModeloDisciplina,
  VisorResponse,
  CatalogoResponse,
  CeldaData,
  CeldaMatriz,
  Etapa,
  EtapaData,
  MatrizResponse,
  MAX_CELDAS_POR_ENVIO,
  Disciplina,
  DisciplinaData,
  Elemento,
  ElementoData,
  ElementosResponse,
  EstadoResponse,
  GrupoTdi,
  Imagen,
  MAX_PARAMETROS_POR_ENVIO,
  Parametro,
  ParametroData,
  Plantilla,
} from "./types";

/** What the Requisitos BIM screens need from the data service. */
export interface LoinApi {
  getEstado(): Promise<EstadoResponse>;
  updateConfig(patch: { baseProjectId?: string | null; editores?: Responsable[]; valoresBasura?: string[] | null; umbralAmarillo?: number | null }): Promise<EstadoResponse>;
  getContacts(): Promise<ProjectContacts>;
  getCatalogo(): Promise<CatalogoResponse>;
  guardarGruposTdi(grupos: GrupoTdi[]): Promise<GrupoTdi[]>;
  /** Several requests when there are many (`onProgress` after each); each request is all or none. */
  guardarParametros(filas: ConVersion<ParametroData>[], onProgress?: (hechos: number) => void): Promise<Parametro[]>;
  getElementos(): Promise<ElementosResponse>;
  guardarDisciplina(fila: ConVersion<DisciplinaData>): Promise<Disciplina>;
  guardarElemento(fila: ConVersion<ElementoData>): Promise<Elemento>;
  cargarSugeridas(): Promise<{ disciplinas: number; elementos: number; yaExistian: string[] }>;
  subirImagen(elementoId: string, archivo: { blob: Blob; nombre: string; ancho: number; alto: number }): Promise<Imagen>;
  eliminarImagen(id: string): Promise<void>;
  listPlantillas(): Promise<Plantilla[]>;
  crearPlantilla(p: { disciplinaId: string; nombre: string; descripcion: string }): Promise<{ plantilla: Plantilla; imagenesOmitidas: number }>;
  cambiarPlantilla(p: { id: string; version: number; nombre?: string; descripcion?: string; activo?: boolean }): Promise<Plantilla>;
  aplicarPlantilla(plantillaId: string): Promise<{ disciplina: Disciplina; elementos: number; parametrosQuitados: number; imagenesOmitidas: number }>;
  getMatriz(): Promise<MatrizResponse>;
  guardarEtapa(fila: ConVersion<EtapaData>): Promise<Etapa>;
  cargarEtapasSugeridas(): Promise<{ etapas: number; yaExistian: string[] }>;
  /** Several requests when there are many (each one all or none). */
  guardarMatriz(filas: ConVersion<CeldaData>[], onProgress?: (hechos: number) => void): Promise<CeldaMatriz[]>;
  getVisor(): Promise<VisorResponse>;
  guardarModelo(m: { fileId: string; nombre: string; disciplinaIds: string[] }): Promise<ModeloDisciplina>;
  /** Several requests when there are many; `elementoId` null unlinks. */
  asociar(elementoId: string | null, objetos: { ifcGuid: string; fileId: string }[], onProgress?: (hechos: number) => void): Promise<number>;
  getCamposModelo(): Promise<CamposModelo | null>;
  guardarCamposModelo(data: Pick<CamposModelo, "modelos" | "campos">): Promise<number>;
  getAuditorias(): Promise<Auditoria[]>;
  getAuditoria(id: string): Promise<{ auditoria: Auditoria; lotes: LoteAuditoria[] }>;
  /** Saves a whole audit: its header, its objects in slices (several requests) and then closes it. */
  guardarAuditoria(informe: InformeAuditoria, nota: string, onProgress?: (hechas: number, total: number) => void): Promise<Auditoria>;
  getExcepciones(): Promise<Excepcion[]>;
  crearExcepciones(filas: NuevaExcepcion[]): Promise<number>;
  revocarExcepcion(id: string, motivo: string): Promise<Excepcion>;
}

/** Slices grouped so each request stays well under the hosting's body limit. */
export function agruparLotes(lotes: LoteAuditoria[], maxBytes = 1_500_000, maxPorEnvio = MAX_LOTES_POR_ENVIO): LoteAuditoria[][] {
  const grupos: LoteAuditoria[][] = [];
  let actual: LoteAuditoria[] = [];
  let bytes = 0;
  for (const l of lotes) {
    const n = JSON.stringify(l).length;
    if (actual.length && (bytes + n > maxBytes || actual.length >= maxPorEnvio)) {
      grupos.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(l);
    bytes += n;
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}

/** Calls /api/loin with the user's Trimble token (asked again once if Trimble rejects it). */
function requester(projectId: string, auth: TokenSource) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const send = (token: string) =>
      fetch(`/api/loin${path}${sep}projectId=${encodeURIComponent(projectId)}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    let token = auth.get();
    if (auth.refresh && (!token || expiresSoon(token))) token = (await auth.refresh()) || token;
    let res = await send(token);
    if (res.status === 401 && auth.refresh) {
      const fresh = await auth.refresh();
      if (fresh) res = await send(fresh);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      let text: string = body.error ?? `Error ${res.status}`;
      if (res.status === 401 && auth.describe) text += ` (Diagnóstico: ${auth.describe()}.)`;
      throw new ApiError(text, res.status, body.code);
    }
    return body as T;
  };
}

export function loinApi(projectId: string, auth: TokenSource): LoinApi {
  const request = requester(projectId, auth);
  const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

  return {
    getEstado: () => request("/estado"),
    updateConfig: (patch) => request("/config", send("PUT", patch)),
    getContacts: () => request("/contactos"),
    getCatalogo: () => request("/catalogo"),
    guardarGruposTdi: (grupos) => request<{ tdiGrupos: GrupoTdi[] }>("/catalogo/tdi", send("PUT", { grupos })).then((r) => r.tdiGrupos),
    async guardarParametros(filas, onProgress) {
      const out: Parametro[] = [];
      for (let i = 0; i < filas.length; i += MAX_PARAMETROS_POR_ENVIO) {
        const lote = filas.slice(i, i + MAX_PARAMETROS_POR_ENVIO);
        out.push(...(await request<{ parametros: Parametro[] }>("/catalogo/parametros", send("POST", { parametros: lote }))).parametros);
        onProgress?.(Math.min(i + lote.length, filas.length));
      }
      return out;
    },
    getElementos: () => request("/elementos"),
    guardarDisciplina: (fila) => request<{ disciplina: Disciplina }>("/disciplinas", send("PUT", fila)).then((r) => r.disciplina),
    guardarElemento: (fila) => request<{ elemento: Elemento }>("/elementos", send("PUT", fila)).then((r) => r.elemento),
    cargarSugeridas: () => request("/elementos/sugeridas", { method: "POST" }),
    subirImagen: (elementoId, a) => {
      const q = new URLSearchParams({ elementoId, nombre: a.nombre, ancho: String(a.ancho), alto: String(a.alto) });
      return request<{ imagen: Imagen }>(`/imagenes?${q}`, { method: "POST", body: a.blob, headers: { "Content-Type": a.blob.type } }).then((r) => r.imagen);
    },
    async eliminarImagen(id) {
      await request(`/imagenes/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    listPlantillas: () => request<{ plantillas: Plantilla[] }>("/plantillas").then((r) => r.plantillas),
    crearPlantilla: (p) => request("/plantillas", send("POST", p)),
    cambiarPlantilla: (p) => request<{ plantilla: Plantilla }>("/plantillas", send("PUT", p)).then((r) => r.plantilla),
    aplicarPlantilla: (plantillaId) => request("/plantillas/aplicar", send("POST", { plantillaId })),
    getMatriz: () => request("/matriz"),
    guardarEtapa: (fila) => request<{ etapa: Etapa }>("/etapas", send("PUT", fila)).then((r) => r.etapa),
    cargarEtapasSugeridas: () => request("/etapas/sugeridas", { method: "POST" }),
    async guardarMatriz(filas, onProgress) {
      const out: CeldaMatriz[] = [];
      for (let i = 0; i < filas.length; i += MAX_CELDAS_POR_ENVIO) {
        const lote = filas.slice(i, i + MAX_CELDAS_POR_ENVIO);
        out.push(...(await request<{ celdas: CeldaMatriz[] }>("/matriz", send("POST", { celdas: lote }))).celdas);
        onProgress?.(Math.min(i + lote.length, filas.length));
      }
      return out;
    },
    getVisor: () => request("/visor"),
    guardarModelo: (m) => request<{ modelo: ModeloDisciplina }>("/modelos", send("PUT", m)).then((r) => r.modelo),
    async asociar(elementoId, objetos, onProgress) {
      let n = 0;
      for (let i = 0; i < objetos.length; i += MAX_ASOCIACIONES_POR_ENVIO) {
        const lote = objetos.slice(i, i + MAX_ASOCIACIONES_POR_ENVIO);
        n += (await request<{ asociados: number }>("/asociaciones", send("POST", { elementoId, objetos: lote }))).asociados;
        onProgress?.(Math.min(i + lote.length, objetos.length));
      }
      return n;
    },
    getCamposModelo: () => request<{ campos: CamposModelo | null }>("/campos-modelo").then((r) => r.campos),
    guardarCamposModelo: (data) => request<{ guardados: number }>("/campos-modelo", send("PUT", data)).then((r) => r.guardados),
    getAuditorias: () => request<{ auditorias: Auditoria[] }>("/auditorias").then((r) => r.auditorias),
    getAuditoria: (id) => request(`/auditorias/${encodeURIComponent(id)}`),
    async guardarAuditoria(informe, nota, onProgress) {
      const { resumen, lotes } = aGuardar(informe);
      const id = crypto.randomUUID();
      await request("/auditorias", send("POST", { id, etapaId: resumen.etapa.id, resumen, nota }));
      const grupos = agruparLotes(lotes);
      let hechas = 0;
      for (const g of grupos) {
        await request(`/auditorias/${id}/resultados`, send("POST", { lotes: g }));
        hechas += g.length;
        onProgress?.(hechas, lotes.length);
      }
      return request<{ auditoria: Auditoria }>(`/auditorias/${id}`, send("PUT", { partes: lotes.length })).then((r) => r.auditoria);
    },
    getExcepciones: () => request<{ excepciones: Excepcion[] }>("/excepciones").then((r) => r.excepciones),
    crearExcepciones: (filas) => request<{ creadas: number }>("/excepciones", send("POST", { filas })).then((r) => r.creadas),
    revocarExcepcion: (id, motivo) => request<{ excepcion: Excepcion }>("/excepciones", send("PUT", { id, motivo })).then((r) => r.excepcion),
  };
}
