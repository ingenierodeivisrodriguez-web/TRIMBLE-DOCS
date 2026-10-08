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
  /** Online purchase of a license, when it is open to this person (null otherwise, and for administrators). */
  venta: VentaPublica | null;
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

// ---------------------------------------------------------------- online sales (Mercado Pago)

/** A license on sale: `meses` (1 to 12) for `precio` (whole pesos). */
export interface Plan {
  meses: number;
  precio: number;
}

/** What a person can buy, when online sales are open to them. */
export interface VentaPublica {
  planes: Plan[];
  moneda: string;
  /** Test credentials: the checkout is Mercado Pago's sandbox. */
  prueba: boolean;
}

export type EstadoOrden = "pendiente" | "aprobada" | "revisar" | "reembolsada";

/** A purchase just started: pay it at `url` (Mercado Pago), then follow it by `orden`. */
export interface CompraIniciada {
  orden: string;
  url: string;
  meses: number;
  monto: number;
  moneda: string;
  /** The expiry the license will have once paid. */
  vence: string | null;
}

/** How a purchase is going, as its buyer sees it. */
export interface EstadoCompra {
  orden: string;
  estado: EstadoOrden;
  estadoMp: string | null;
  detalleMp: string | null;
  meses: number;
  monto: number;
  moneda: string;
  /** The license's expiry once applied. */
  vence: string | null;
  /** "Pago rechazado: fondos insuficientes" and the like. */
  texto: string;
}

/** A purchase of a license: created when the person goes to pay, applied when Mercado Pago approves the payment. */
export interface Orden {
  id: string;
  email: string;
  nombre: string;
  meses: number;
  monto: number;
  moneda: string;
  estado: EstadoOrden;
  preferenciaId: string | null;
  /** The approved payment in Mercado Pago. */
  pagoId: string | null;
  /** Mercado Pago's status of the last payment seen (approved, rejected, in_process...). */
  estadoMp: string | null;
  detalleMp: string | null;
  creada: string;
  pagada: string | null;
  /** The license's expiry before and after the payment (ISO dates). */
  venceAnterior: string | null;
  venceNueva: string | null;
  nota: string | null;
}

export interface ConfigVentaInfo {
  habilitada: boolean;
  planes: Plan[];
  actualizadoPor: string | null;
  actualizadoEn: string | null;
  mercadoPago: {
    /** MERCADOPAGO_ACCESS_TOKEN is set in Vercel. */
    configurado: boolean;
    prueba: boolean;
    /** MERCADOPAGO_WEBHOOK_SECRET is set (notifications are verified). */
    firma: boolean;
    /** Where Mercado Pago notifies payments, and where buyers come back to. */
    webhook: string;
    retorno: string;
  };
}
