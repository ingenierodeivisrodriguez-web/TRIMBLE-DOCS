// The 3D viewer's camera convention, measured in Fase 0 (26-11-2026) and checked at four azimuths:
// pitch 0 looks straight down and π/2 is level; the view direction is yaw + 90° counter-clockwise
// from the model's +X. Azimuth here is counter-clockwise from +X (the plan's "rumbo"); elevation is
// positive upwards.

export const rad = (grados: number) => (grados * Math.PI) / 180;

export function camaraTrimble(azimutGrados: number, elevacionGrados = 0): { yaw: number; pitch: number } {
  return { yaw: rad(azimutGrados - 90), pitch: rad(elevacionGrados + 90) };
}

/** Azimuth (0–360°) and elevation of a camera from its position and lookAt. */
export function direccionCamara(p: { x: number; y: number; z: number }, l: { x: number; y: number; z: number }): { azimut: number; elevacion: number } {
  const azimut = ((((Math.atan2(l.y - p.y, l.x - p.x) * 180) / Math.PI) % 360) + 360) % 360;
  const elevacion = (Math.atan2(l.z - p.z, Math.hypot(l.x - p.x, l.y - p.y)) * 180) / Math.PI;
  return { azimut, elevacion };
}

/** Smallest difference between two angles in degrees (359° vs 1° = 2°). */
export function diferenciaAngular(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** A floor: the clicked face looks up (within 15°). */
export function esCaraDePiso(normal: [number, number, number] | null): boolean {
  if (!normal) return false;
  const largo = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return normal[2] / largo >= Math.cos(rad(15));
}
