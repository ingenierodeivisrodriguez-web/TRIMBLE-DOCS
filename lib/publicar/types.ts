/** What the browser and the server of "Publicar entre proyectos" exchange. */

export interface ProyectoInfo {
  id: string;
  nombre: string;
  /** The project the extension is open in. */
  actual: boolean;
  /** Its region, as Trimble names it ("northAmerica", "europe"...). */
  region: string;
}

export interface ItemCarpeta {
  id: string;
  nombre: string;
  tipo: "carpeta" | "archivo";
  /** Bytes (files only). */
  tamano: number | null;
  /** Number of the latest version (files only). */
  revision: number | null;
  modificado: string | null;
}

export interface CarpetaInfo {
  proyecto: { id: string; nombre: string };
  carpeta: {
    id: string;
    nombre: string;
    /** From the project's root down to this folder (both included). */
    ruta: { id: string; nombre: string }[];
    /** The user's access to it. */
    permiso: "READ" | "FULL_ACCESS" | null;
  };
  /** Folders first, then files, each by name. */
  items: ItemCarpeta[];
}

/**
 * The steps of copying one file to another project, one request each:
 * compare it with what the destination folder has, copy its latest
 * version, follow the upload, and ask how the destination's viewer
 * conversion is going.
 */
export type PasoCopia = "revisar" | "copiar" | "estado-subida" | "estado-visor";

export const PASOS_COPIA: PasoCopia[] = ["revisar", "copiar", "estado-subida", "estado-visor"];

/**
 * What the destination folder has under the file's name: nothing ("nuevo"),
 * the same content ("al-dia") or something else ("distinto", which is only
 * replaced when the person says so).
 */
export type Situacion = "nuevo" | "al-dia" | "distinto";

export interface CopiaResponse {
  paso: PasoCopia;
  ok: boolean;
  /** What happened, in plain words. */
  mensaje: string;
  datos: Record<string, unknown>;
}
