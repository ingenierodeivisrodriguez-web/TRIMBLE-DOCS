// TEMPORARY (Inspección 360°, Fase 0). The 3D viewer's picking can report positions in metres or
// millimetres depending on the model (Realidad aumentada found both), while addIcon, setCamera and
// addPanorama say "metres". The spike guesses the unit from the clicked element's box and the
// person confirms it by looking at where the icons land.

export type Vec3 = [number, number, number];
export interface Caja {
  min: Vec3;
  max: Vec3;
}

/** No building element is larger than 100 m in metres; in millimetres almost all are. */
export function unidadProbable(caja: Caja): "m" | "mm" {
  const mayor = Math.max(caja.max[0] - caja.min[0], caja.max[1] - caja.min[1], caja.max[2] - caja.min[2]);
  return mayor > 100 ? "mm" : "m";
}

/** A viewer position in metres, given the unit the viewer reports in. */
export function aMetros(p: Vec3, unidad: "m" | "mm"): Vec3 {
  const f = unidad === "mm" ? 0.001 : 1;
  return [p[0] * f, p[1] * f, p[2] * f];
}

/** Degrees → radians, for setCamera's yaw and pitch. */
export const rad = (grados: number) => (grados * Math.PI) / 180;

/**
 * The viewer's camera convention, measured in the first real test (26-11-2026): pitch 0 looks
 * straight down and π/2 is level; the view direction is yaw + 90° counter-clockwise from +X.
 * Azimuth here is counter-clockwise from the model's +X (the plan's "rumbo"); elevation is
 * positive upwards.
 */
export function camaraTrimble(azimutGrados: number, elevacionGrados = 0): { yaw: number; pitch: number } {
  return { yaw: rad(azimutGrados - 90), pitch: rad(elevacionGrados + 90) };
}

/** Azimuth (0–360°, counter-clockwise from +X) and elevation of a camera from its position and lookAt. */
export function direccionCamara(
  p: { x: number; y: number; z: number },
  l: { x: number; y: number; z: number },
): { azimut: number; elevacion: number } {
  const azimut = (((Math.atan2(l.y - p.y, l.x - p.x) * 180) / Math.PI) % 360 + 360) % 360;
  const elevacion = (Math.atan2(l.z - p.z, Math.hypot(l.x - p.x, l.y - p.y)) * 180) / Math.PI;
  return { azimut, elevacion };
}

/** Smallest difference between two angles in degrees (359° vs 1° = 2°). */
export function diferenciaAngular(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}
