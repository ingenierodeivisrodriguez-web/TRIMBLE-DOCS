// Pure rules of the walk between 360° points: the heading ("rumbo") of a point's photos measured
// with one click in the photo and one in the 3D model, where each neighbouring point appears in a
// photo, and which date and direction to open when walking to it.
//
// Conventions:
// - Model azimuth: degrees counter-clockwise from the model's +X (as in camara.ts).
// - Photo yaw (Photo Sphere Viewer): radians, 0 at the middle of the photo, growing to the right
//   (clockwise seen from above). It is the yaw on screen, with the photo's alignment turn applied.
// - Rumbo of a point: the model azimuth the photos face at yaw 0. All the dates of a point are
//   lined up with each other by their turn, so one rumbo serves every date.

import { capturasComparables } from "./comparar";
import type { CapturaVista, PuntoVista } from "./types";

/** Neighbours farther than this are not shown in a photo. */
export const DISTANCIA_VECINOS_M = 20;

const GRADOS = 180 / Math.PI;

/** Degrees brought to [0, 360), rounded to a tenth. */
export function normalizar360(grados: number): number {
  if (!Number.isFinite(grados)) return 0;
  const r = Math.round((((grados % 360) + 360) % 360) * 10) / 10;
  return r === 360 ? 0 : r;
}

/** Radians brought to (−π, π]. */
function normalizarRad(r: number): number {
  let v = r % (2 * Math.PI);
  if (v > Math.PI) v -= 2 * Math.PI;
  if (v <= -Math.PI) v += 2 * Math.PI;
  return v;
}

type Lugar = { x: number; y: number };

/** Model azimuth from `a` to `b` (degrees, counter-clockwise from +X). */
export function azimutEntre(a: Lugar, b: Lugar): number {
  return normalizar360(Math.atan2(b.y - a.y, b.x - a.x) * GRADOS);
}

export function distanciaHorizontal(a: Lugar, b: Lugar): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The point's rumbo from one element seen in both places: the yaw where it was clicked in the
 * photo and the model azimuth from the tripod to where it was clicked in the model.
 */
export function rumboDesdeCalibracion(yawFoto: number, azimutModelo: number): number {
  return normalizar360(azimutModelo + yawFoto * GRADOS);
}

/** The photo yaw (radians) that looks toward a model azimuth, for a point with that rumbo. */
export function yawHacia(rumbo: number, azimut: number): number {
  return normalizarRad((rumbo - azimut) / GRADOS);
}

/** The yaw in another point's photo that looks the same way in the model (the same yaw when either is not calibrated). */
export function yawEquivalente(yaw: number, rumboDesde: number | null, rumboHasta: number | null): number {
  if (rumboDesde === null || rumboHasta === null) return normalizarRad(yaw);
  return normalizarRad(yaw + (rumboHasta - rumboDesde) / GRADOS);
}

export interface Vecino {
  puntoId: string;
  codigo: string;
  /** Short label on the photo: C02. */
  etiqueta: string;
  espacio: string;
  distancia: number;
  /** Where to draw it: on the floor where its tripod stood (radians). */
  yaw: number;
  pitch: number;
}

/**
 * The points to show in a photo of `punto`: active, with photos, on the same tower and floor and
 * within `maxDistancia` metres, nearest first. None until the point's rumbo is calibrated.
 */
export function vecinos(punto: PuntoVista, puntos: readonly PuntoVista[], maxDistancia = DISTANCIA_VECINOS_M): Vecino[] {
  if (punto.rumboGrados === null) return [];
  const rumbo = punto.rumboGrados;
  return puntos
    .filter((p) => p.id !== punto.id && p.estado === "activo" && p.capturas > 0 && p.torre === punto.torre && p.piso === punto.piso)
    .map((p) => ({ p, d: distanciaHorizontal(punto, p) }))
    .filter(({ d }) => d >= 0.3 && d <= maxDistancia)
    .sort((a, b) => a.d - b.d)
    .map(({ p, d }) => ({
      puntoId: p.id,
      codigo: p.codigo,
      etiqueta: `C${String(p.numero).padStart(2, "0")}`,
      espacio: p.espacio,
      distancia: Math.round(d * 10) / 10,
      yaw: yawHacia(rumbo, azimutEntre(punto, p)),
      pitch: Math.atan2(p.z - p.alturaM - punto.z, d),
    }));
}

/** The capture of a point to open when arriving from a photo taken at `fecha`: the closest date. */
export function capturaMasCercana(capturas: readonly CapturaVista[], fecha: string): CapturaVista | null {
  const t = Date.parse(fecha);
  let mejor: CapturaVista | null = null;
  let diferencia = Infinity;
  for (const c of capturasComparables(capturas)) {
    const d = Math.abs(Date.parse(c.tomadaEn) - t);
    if (d < diferencia) {
      mejor = c;
      diferencia = d;
    }
  }
  return mejor;
}
