import { createRequester, TokenSource } from "../propiedades/client";
import type { CarpetaInfo, PasoPrueba, ProyectoInfo, PruebaResponse } from "./types";

export interface PublicarApi {
  /** The projects the user belongs to (the current one first). */
  proyectos(): Promise<{ proyectos: ProyectoInfo[] }>;
  /** A folder of one of those projects (its root when no folder is given). */
  carpeta(proyecto: string, folderId?: string | null): Promise<CarpetaInfo>;
  /** One step of the copy test. */
  prueba(paso: PasoPrueba, datos?: Record<string, string>): Promise<PruebaResponse>;
}

/** The HTTP client for /api/publicar, authenticated with the user's Trimble token. */
export function publicarApi(projectId: string, auth: TokenSource): PublicarApi {
  const request = createRequester("/api/publicar", projectId, auth);
  return {
    proyectos: () => request("/proyectos"),
    carpeta: (proyecto, folderId) => {
      const q = new URLSearchParams({ proyecto });
      if (folderId) q.set("folderId", folderId);
      return request(`/carpeta?${q.toString()}`);
    },
    prueba: (paso, datos = {}) => request("/prueba", { method: "POST", body: JSON.stringify({ ...datos, paso }) }),
  };
}
