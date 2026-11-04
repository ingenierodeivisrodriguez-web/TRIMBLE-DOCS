import { createRequester, TokenSource } from "../propiedades/client";
import type { CarpetaInfo } from "../publicar/types";
import type { PasoPrueba, PruebaResponse } from "./types";

export interface FlujoApi {
  /** A folder of this project (its root when no folder is given). */
  carpeta(proyecto: string, folderId?: string | null): Promise<CarpetaInfo>;
  /** One step of the phase 0 test against the real Trimble Connect. */
  prueba(paso: PasoPrueba, datos: Record<string, string>): Promise<PruebaResponse>;
}

/** The HTTP client for /api/flujo-aprobacion, authenticated with the user's Trimble token. */
export function flujoApi(projectId: string, auth: TokenSource): FlujoApi {
  const request = createRequester("/api/flujo-aprobacion", projectId, auth);
  return {
    carpeta: (proyecto, folderId) => {
      const q = new URLSearchParams({ proyecto });
      if (folderId) q.set("folderId", folderId);
      return request(`/carpeta?${q.toString()}`);
    },
    prueba: (paso, datos) => request("/prueba", { method: "POST", body: JSON.stringify({ ...datos, paso }) }),
  };
}
