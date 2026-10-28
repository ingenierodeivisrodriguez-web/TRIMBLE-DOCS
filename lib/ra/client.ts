import { ApiError, createRequester, TokenSource } from "../propiedades/client";
import { expiresSoon } from "../propiedades/token";
import { descomprimir, desempaquetar } from "./formato";
import type { ModeloRA } from "./modelo";
import type { ArchivoFuente, ConfigRA, EstadoResponse, ModeloVista, NuevoModelo, NuevoPunto, PuntoVista, SubidaResponse } from "./types";

export type Progreso = (cargados: number, total: number | null) => void;

/** What the AR screens need from the server. */
export interface RaApi {
  getEstado(): Promise<EstadoResponse>;
  guardarConfig(diasSinUso: number): Promise<ConfigRA>;
  /** The IFC's bytes, streamed through the server, reporting progress. */
  descargarIfc(archivo: ArchivoFuente, alAvanzar?: Progreso, signal?: AbortSignal): Promise<Uint8Array>;
  /** Registers the model, uploads its file and confirms it. */
  subirModelo(datos: NuevoModelo, archivo: Uint8Array, alAvanzar?: Progreso): Promise<ModeloVista>;
  eliminar(id: string): Promise<ModeloVista>;
  /** A ready model's file, read back (to place a QR on it). */
  leerModelo(id: string, alAvanzar?: Progreso): Promise<ModeloRA>;
  crearPunto(p: NuevoPunto): Promise<PuntoVista>;
  anularPunto(id: string): Promise<PuntoVista>;
}

async function leerConProgreso(res: Response, alAvanzar?: Progreso): Promise<Uint8Array> {
  const total = Number(res.headers.get("content-length")) || null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let cargados = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partes.push(value);
    cargados += value.length;
    alAvanzar?.(cargados, total);
  }
  const out = new Uint8Array(cargados);
  let p = 0;
  for (const parte of partes) {
    out.set(parte, p);
    p += parte.length;
  }
  return out;
}

/** PUT to the signed URL with upload progress (fetch has none for uploads). */
function subirArchivo(url: string, datos: Uint8Array, alAvanzar?: Progreso): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => alAvanzar?.(e.loaded, e.lengthComputable ? e.total : datos.length);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`El almacenamiento rechazó el archivo (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`, xhr.status)));
    xhr.onerror = () => reject(new ApiError("No se pudo enviar el archivo al almacenamiento (revise la conexión).", 0));
    xhr.send(datos as unknown as XMLHttpRequestBodyInit);
  });
}

export function raApi(projectId: string, auth: TokenSource): RaApi {
  const request = createRequester("/api/ra", projectId, auth);
  return {
    getEstado: () => request<EstadoResponse>("/estado"),
    guardarConfig: (diasSinUso) => request<ConfigRA>("/config", { method: "PUT", body: JSON.stringify({ diasSinUso }) }),
    async descargarIfc(archivo, alAvanzar, signal) {
      const q = new URLSearchParams({ fileId: archivo.fileId, projectId, ...(archivo.versionId ? { versionId: archivo.versionId } : {}) });
      const send = (token: string) => fetch(`/api/ra/ifc?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      let token = auth.get();
      if (auth.refresh && (!token || expiresSoon(token))) token = (await auth.refresh()) || token;
      let res = await send(token);
      if (res.status === 401 && auth.refresh) {
        const fresh = await auth.refresh();
        if (fresh) res = await send(fresh);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body.error ?? `Error ${res.status}`, res.status, body.code);
      }
      return leerConProgreso(res, alAvanzar);
    },
    async subirModelo(datos, archivo, alAvanzar) {
      const { modelo, urlSubida } = await request<SubidaResponse>("/modelos", { method: "POST", body: JSON.stringify(datos) });
      await subirArchivo(urlSubida, archivo, alAvanzar);
      return request<ModeloVista>(`/modelos/${encodeURIComponent(modelo.id)}/confirmar`, { method: "POST" });
    },
    eliminar: (id) => request<ModeloVista>(`/modelos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    async leerModelo(id, alAvanzar) {
      const { url } = await request<{ url: string }>(`/modelos/${encodeURIComponent(id)}/archivo`);
      const res = await fetch(url);
      if (!res.ok) throw new ApiError(`El almacenamiento no entregó el modelo (HTTP ${res.status}).`, res.status);
      return desempaquetar(await descomprimir(await leerConProgreso(res, alAvanzar)));
    },
    crearPunto: (p) => request<PuntoVista>("/puntos", { method: "POST", body: JSON.stringify(p) }),
    anularPunto: (id) => request<PuntoVista>(`/puntos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}
