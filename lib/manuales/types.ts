// Shared by the "Manuales" API and its screen.

export interface ItemManual {
  id: string;
  nombre: string;
  tipo: "carpeta" | "archivo";
  /** Lower-case extension ("pdf"), "" for folders and files without one. */
  ext: string;
  tamano: number;
  modificado: string;
  modificadoPor: string;
  versionId: string;
  version: number;
}

export interface Biblioteca {
  /** The "MANAGER PROJECT" that holds the manuals. */
  projectId: string;
  projectName: string;
  /** The container folder the app shows. */
  carpetaId: string;
  carpetaNombre: string;
  /** The caller's access to it. */
  permiso: "READ" | "FULL_ACCESS" | null;
}

export interface CarpetaResponse {
  biblioteca: Biblioteca;
  carpeta: {
    id: string;
    nombre: string;
    /** From the container down to this folder (both included). */
    ruta: { id: string; nombre: string }[];
  };
  items: ItemManual[];
}

export interface ResultadoBusqueda extends ItemManual {
  carpetaId: string;
  /** "Normas / Seguridad" (folders below the container). */
  ruta: string;
}

export interface BusquedaResponse {
  resultados: ResultadoBusqueda[];
  /** False when the search stopped early (too many folders or results). */
  completa: boolean;
}

export interface ArchivoResponse {
  url: string;
  nombre: string;
  ext: string;
  tamano: number;
  versionId: string;
  /** Opens the file in Trimble Connect's own viewer. */
  enTrimble: string;
}
