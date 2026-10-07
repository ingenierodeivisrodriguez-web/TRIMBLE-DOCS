import { ApiError, createRequester, TokenSource } from "../propiedades/client";
import { expiresSoon } from "../propiedades/token";
import type { ArchivoResponse, BusquedaResponse, CarpetaResponse } from "./types";

export interface ManualesApi {
  carpeta(folderId?: string | null): Promise<CarpetaResponse>;
  buscar(q: string): Promise<BusquedaResponse>;
  /** A fresh link to the file (or its PDF rendition) and the link to open it in Trimble Connect. */
  archivo(fileId: string, pdf?: boolean): Promise<ArchivoResponse>;
  /** The file's content (or its PDF rendition), reporting progress as it arrives. */
  contenido(fileId: string, pdf: boolean, onProgress?: (loaded: number, total: number | null) => void, signal?: AbortSignal): Promise<Blob>;
}

export function manualesApi(projectId: string, auth: TokenSource): ManualesApi {
  const request = createRequester("/api/manuales", projectId, auth);
  const q = (params: Record<string, string | null | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
    const text = s.toString();
    return text ? `?${text}` : "";
  };

  async function contenido(fileId: string, pdf: boolean, onProgress?: (loaded: number, total: number | null) => void, signal?: AbortSignal): Promise<Blob> {
    const url = `/api/manuales/archivo/contenido${q({ fileId, pdf: pdf ? "1" : null, projectId })}`;
    const send = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
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
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    const total = Number(res.headers.get("content-length")) || null;
    if (!res.body) return new Blob([await res.arrayBuffer()], { type });
    const reader = res.body.getReader();
    const partes: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partes.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    return new Blob(partes as BlobPart[], { type });
  }

  return {
    carpeta: (folderId) => request(`/carpeta${q({ folderId })}`),
    buscar: (text) => request(`/buscar${q({ q: text })}`),
    archivo: (fileId, pdf) => request(`/archivo${q({ fileId, pdf: pdf ? "1" : null })}`),
    contenido,
  };
}
