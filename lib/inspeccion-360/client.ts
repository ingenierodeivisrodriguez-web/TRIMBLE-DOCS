import { ApiError, createRequester, TokenSource } from "../propiedades/client";
import { expiresSoon } from "../propiedades/token";
import type { CambiosPunto, CapturaVista, ConfigI360, EstadoResponse, MiembroProyecto, NuevaSubida, NuevoPunto, Punto, PuntoVista, SubidaResponse } from "./types";

export type Progreso = (cargados: number, total: number | null) => void;

/** What the Inspección 360° screens need from the server. */
export interface I360Api {
  estado(): Promise<EstadoResponse>;
  guardarConfig(c: { codigoProyecto: string | null; editores: string[]; version: number }): Promise<ConfigI360>;
  miembros(): Promise<Pick<MiembroProyecto, "id" | "nombre">[]>;
  puntos(): Promise<PuntoVista[]>;
  crearPunto(p: NuevoPunto): Promise<PuntoVista>;
  editarPunto(id: string, cambios: CambiosPunto): Promise<Punto>;
  capturas(puntoId: string): Promise<CapturaVista[]>;
  /** Registers the capture, puts the photo in the temporary storage and moves it to the CDE. */
  subirFoto(datos: NuevaSubida, archivo: Blob, alAvanzar?: Progreso, alConfirmar?: () => void): Promise<CapturaVista>;
  /** Retries moving an already uploaded photo to the CDE. */
  confirmar(fotoId: string): Promise<CapturaVista>;
  anular(capturaId: string, motivo: string): Promise<CapturaVista>;
  /** The photo's bytes from the CDE (through the server), reporting progress. */
  foto(fotoId: string, alAvanzar?: Progreso, signal?: AbortSignal): Promise<Blob>;
}

/** PUT to the signed URL with upload progress (fetch has none for uploads). */
function subirArchivo(url: string, archivo: Blob, alAvanzar?: Progreso): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "image/jpeg");
    xhr.upload.onprogress = (e) => alAvanzar?.(e.loaded, e.lengthComputable ? e.total : archivo.size);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`El almacenamiento rechazó la foto (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`, xhr.status)));
    xhr.onerror = () => reject(new ApiError("No se pudo enviar la foto (revise la conexión).", 0));
    xhr.send(archivo);
  });
}

async function leerConProgreso(res: Response, alAvanzar?: Progreso): Promise<Blob> {
  const total = Number(res.headers.get("content-length")) || null;
  if (!res.body) return new Blob([await res.arrayBuffer()], { type: "image/jpeg" });
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
  return new Blob(partes as BlobPart[], { type: "image/jpeg" });
}

export function i360Api(projectId: string, auth: TokenSource): I360Api {
  const request = createRequester("/api/inspeccion-360", projectId, auth);
  const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  return {
    estado: () => request<EstadoResponse>("/estado"),
    guardarConfig: (c) => request<ConfigI360>("/config", { method: "PUT", body: JSON.stringify(c) }),
    miembros: () => request<Pick<MiembroProyecto, "id" | "nombre">[]>("/miembros"),
    puntos: () => request<PuntoVista[]>("/puntos"),
    crearPunto: (p) => request<PuntoVista>("/puntos", json(p)),
    editarPunto: (id, cambios) => request<Punto>(`/puntos/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(cambios) }),
    capturas: (puntoId) => request<CapturaVista[]>(`/puntos/${encodeURIComponent(puntoId)}/capturas`),
    async subirFoto(datos, archivo, alAvanzar, alConfirmar) {
      const s = await request<SubidaResponse>("/subidas", json(datos));
      await subirArchivo(s.url, archivo, alAvanzar);
      alConfirmar?.();
      return request<CapturaVista>(`/subidas/${encodeURIComponent(s.captura.foto!.id)}/confirmar`, { method: "POST" });
    },
    confirmar: (fotoId) => request<CapturaVista>(`/subidas/${encodeURIComponent(fotoId)}/confirmar`, { method: "POST" }),
    anular: (capturaId, motivo) => request<CapturaVista>(`/capturas/${encodeURIComponent(capturaId)}/anular`, json({ motivo })),
    async foto(fotoId, alAvanzar, signal) {
      const url = `/api/inspeccion-360/fotos/${encodeURIComponent(fotoId)}/contenido?projectId=${encodeURIComponent(projectId)}`;
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
      return leerConProgreso(res, alAvanzar);
    },
  };
}
