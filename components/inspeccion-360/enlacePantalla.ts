"use client";

// The full screen tab of a single 360° photo. The point sheet is created again for every point,
// so the link to the tab lives here: the sheet on screen sends the tab each photo it opens, and
// answers the tab when a neighbouring point is clicked there (walk to it, or back).

import type { VistaFoto } from "./Visor360";

type AlPedirPunto = (puntoId: string, vista: VistaFoto | undefined) => void;

let ventana: Window | null = null;
let entregado = false;
let ultimo: Record<string, unknown> | null = null;
let alPedirPunto: AlPedirPunto | null = null;
let quitar: (() => void) | null = null;

function vistaValida(v: unknown): VistaFoto | undefined {
  const o = v as Partial<VistaFoto> | null;
  return o && [o.yaw, o.pitch, o.zoom].every((n) => typeof n === "number" && Number.isFinite(n)) ? (o as VistaFoto) : undefined;
}

function abierta(): boolean {
  return !!ventana && !ventana.closed;
}

/**
 * Opens the tab (or reuses the one already open) with this photo. Returns an error text when the
 * browser blocked the new window.
 */
export function abrirPantallaFoto(datos: Record<string, unknown>): string | null {
  ultimo = datos;
  if (abierta()) {
    if (entregado) ventana!.postMessage(datos, window.location.origin);
    ventana!.focus();
    return null;
  }
  quitar?.();
  const v = window.open("/inspeccion-360/pantalla", "_blank");
  if (!v) return "El navegador bloqueó la ventana nueva: permita ventanas emergentes para trimble-docs.vercel.app.";
  ventana = v;
  entregado = false;
  const origen = window.location.origin;
  const alMensaje = (ev: MessageEvent) => {
    if (ev.source !== v || ev.origin !== origen) return;
    const d = ev.data as { tipo?: string; puntoId?: unknown; vista?: unknown } | null;
    if (d?.tipo === "i360-listo" && !entregado && ultimo) {
      entregado = true;
      v.postMessage(ultimo, origen);
    } else if (d?.tipo === "i360-ir-a-punto" && typeof d.puntoId === "string") {
      alPedirPunto?.(d.puntoId, vistaValida(d.vista));
    }
  };
  window.addEventListener("message", alMensaje);
  const revisar = setInterval(() => {
    if (v.closed) quitar?.();
  }, 5000);
  quitar = () => {
    window.removeEventListener("message", alMensaje);
    clearInterval(revisar);
    if (ventana === v) ventana = null;
    quitar = null;
  };
  return null;
}

/** Sends the tab the photo now open in the panel, when the tab is open. */
export function enviarAPantallaFoto(datos: Record<string, unknown>): void {
  if (!abierta()) return;
  ultimo = datos;
  if (entregado) ventana!.postMessage(datos, window.location.origin);
}

export function pantallaFotoAbierta(): boolean {
  return abierta();
}

/** Who walks to a point clicked in the tab: the point sheet on screen (null when none is). */
export function alPedirPuntoDesdePantalla(fn: AlPedirPunto | null): void {
  alPedirPunto = fn;
}
