import type { EstadoModelo } from "./types";

/**
 * The QR's code: 128 random bits in base64url (22 characters). Whoever has the
 * QR sees the model (owner's decision: no login), so the code must not be
 * guessable; it also expires and can be cancelled.
 */

export const LARGO_CODIGO = 22;
const CODIGO = /^[A-Za-z0-9_-]{22}$/;

export function generarCodigo(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const esCodigo = (c: string) => CODIGO.test(c);

export const BASE_PUBLICA = "https://trimble-docs.vercel.app";

/** What the QR holds: the phone page with the code. */
export const urlQr = (codigo: string, base = BASE_PUBLICA) => `${base.replace(/\/+$/, "")}/ra/q/${codigo}`;

export type EstadoQr = "activo" | "vencido" | "anulado" | "sin-modelo";

/** Whether a QR opens: not cancelled, not past its date, and its model still has its file. */
export function estadoQr(qr: { anulado: string | null; vence: string }, modelo: { estado: EstadoModelo } | null, ahora: Date): EstadoQr {
  if (qr.anulado) return "anulado";
  if (new Date(qr.vence).getTime() <= ahora.getTime()) return "vencido";
  if (!modelo || modelo.estado !== "listo") return "sin-modelo";
  return "activo";
}

export const TEXTO_ESTADO_QR: Record<EstadoQr, string> = {
  activo: "Activo",
  vencido: "Vencido",
  anulado: "Anulado",
  "sin-modelo": "Sin modelo (eliminado)",
};

export const DIAS_QR_INICIAL = 30;
export const DIAS_QR_MAX = 365;

/**
 * End of the chosen day (DD-MM-AAAA picked as "AAAA-MM-DD") in Colombian time,
 * as an instant: a QR "valid until the 30th" works all of that day.
 */
export function finDelDia(fechaIso: string): string {
  return new Date(`${fechaIso}T23:59:59-05:00`).toISOString();
}

/** "AAAA-MM-DD" of `dias` after `desde`, in Colombian time (for the date field's default). */
export function fechaMasDias(desde: Date, dias: number): string {
  const d = new Date(desde.getTime() + dias * 86_400_000 - 5 * 3_600_000);
  return d.toISOString().slice(0, 10);
}
