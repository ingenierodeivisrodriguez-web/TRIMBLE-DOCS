import type { EstadoLicencia } from "./licencia";
import type { IdPasarela } from "./pasarelas";

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

// ---------------------------------------------------------------- online sales (Mercado Pago, Wompi)

/** A license on sale: `meses` (1 to 12) for `precio` (whole pesos). */
export interface Plan {
  meses: number;
  precio: number;
}

/** What a person can buy, when online sales are open to them, and the gateways they can pay with. */
export interface VentaPublica {
  planes: Plan[];
  moneda: string;
  pasarelas: {
    id: IdPasarela;
    nombre: string;
    /** Test credentials: payments are simulated. */
    prueba: boolean;
  }[];
}

export type EstadoOrden = "pendiente" | "aprobada" | "revisar" | "reembolsada";

/** A purchase just started: pay it at `url` (the gateway's checkout), then follow it by `orden`. */
export interface CompraIniciada {
  orden: string;
  url: string;
  pasarela: IdPasarela;
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
  pasarela: IdPasarela;
  estadoPago: string | null;
  detallePago: string | null;
  meses: number;
  monto: number;
  moneda: string;
  /** The license's expiry once applied. */
  vence: string | null;
  /** "Pago rechazado: fondos insuficientes" and the like. */
  texto: string;
}

/** A purchase of a license: created when the person goes to pay, applied when the gateway approves the payment. */
export interface Orden {
  id: string;
  email: string;
  nombre: string;
  meses: number;
  monto: number;
  moneda: string;
  /** The gateway the person chose to pay with. */
  pasarela: IdPasarela;
  estado: EstadoOrden;
  /** The gateway's checkout id (Mercado Pago's preference), when it has one. */
  preferenciaId: string | null;
  /** The approved payment in the gateway. */
  pagoId: string | null;
  /** Status of the last payment seen, in the common vocabulary (approved, rejected, pending...), and the gateway's own detail. */
  estadoPago: string | null;
  detallePago: string | null;
  creada: string;
  pagada: string | null;
  /** Last change (for a refunded purchase, when the refund arrived). */
  actualizada: string;
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
    /** The Mercado Pago account the credentials belong to (null when they couldn't be checked). */
    cuenta: { id: string; nombre: string; email: string } | null;
    /** Why the credentials couldn't be checked (rejected, Mercado Pago unreachable...). */
    error: string | null;
    /** A test account: payments are simulated. */
    prueba: boolean;
    /** MERCADOPAGO_WEBHOOK_SECRET is set (notifications are verified). */
    firma: boolean;
    /** Where Mercado Pago notifies payments, and where buyers come back to. */
    webhook: string;
    retorno: string;
  };
  wompi: {
    /** WOMPI_PUBLIC_KEY and WOMPI_INTEGRITY_SECRET are set in Vercel. */
    configurado: boolean;
    /** Sandbox keys (pub_test_...): payments are simulated. */
    prueba: boolean;
    /** WOMPI_PRIVATE_KEY is set (pending purchases can be looked up by reference). */
    privada: boolean;
    /** WOMPI_EVENTS_SECRET is set (events are verified). */
    firma: boolean;
    /** Keys that don't match each other. */
    problemas: string[];
    /** The events URL to set in Wompi's dashboard, and where buyers come back to. */
    eventos: string;
    retorno: string;
  };
}
