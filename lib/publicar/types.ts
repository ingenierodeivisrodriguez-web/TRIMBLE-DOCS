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

/** Created inside the destination folder chosen for the copy test. */
export const CARPETA_PRUEBA = "Publicar entre proyectos - prueba (se puede borrar)";

/** The steps of the copy test, run one request at a time. */
export type PasoPrueba = "leer-origen" | "preparar-destino" | "copiar" | "estado-subida" | "proteccion" | "abrir-copia-navegador" | "comprobar";

export const PASOS_PRUEBA: PasoPrueba[] = ["leer-origen", "preparar-destino", "copiar", "estado-subida", "proteccion", "abrir-copia-navegador", "comprobar"];

export interface PruebaResponse {
  paso: PasoPrueba;
  ok: boolean;
  /** What happened, in plain words. */
  mensaje: string;
  datos: Record<string, unknown>;
}
