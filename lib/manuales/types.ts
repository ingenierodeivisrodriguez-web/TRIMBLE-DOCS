import type { EstadoLicencia } from "./licencia";

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

export interface CuentaInfo {
  nombre: string;
  email: string;
  conectadaPor: string | null;
  conectadaEn: string;
  renovadaEn: string;
}

export interface EstadoManuales {
  usuario: { email: string; nombre: string };
  /** Administrator of the manager project: manages the account and who reads. */
  esAdmin: boolean;
  autorizado: boolean;
  /** Why the user can't read, when they can't (and aren't an administrator). */
  motivo: "sin-autorizacion" | "vencida" | "suspendida" | null;
  /** The user's own license, when they are on the list. */
  licencia: { estado: EstadoLicencia; vence: string | null; diasRestantes: number | null } | null;
  /** The technical account is connected (the manuals can be read). */
  disponible: boolean;
  /** Only for administrators. */
  admin?: {
    oauthConfigurado: boolean;
    /** Where Trimble sends the browser back after signing in. */
    redirectUri: string;
    /** That address doesn't reach this app: the administrator pastes it in Manuales. */
    manual: boolean;
    /** This app's own callback, to register in Trimble's console if possible. */
    callbackPropio: string;
    cuenta: CuentaInfo | null;
  };
}

export interface AutorizadoInfo {
  email: string;
  nombre: string;
  agregadoPor: string | null;
  agregadoEn: string;
  /** 1 to 12, or null (up to a chosen date, or without expiry). */
  licenciaMeses: number | null;
  /** ISO dates; `vence` is the last day with access (null: no expiry). */
  inicio: string | null;
  vence: string | null;
  suspendido: boolean;
  estado: EstadoLicencia;
  /** Days left until `vence` (negative once expired). */
  diasRestantes: number | null;
}
