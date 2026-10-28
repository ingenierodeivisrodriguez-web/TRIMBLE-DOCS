import type { Vec3 } from "./modelo";

/**
 * Placing the model on site (phase 3). The phone finds the sheet's cross on
 * the wall: a point and the wall's normal, in the AR session's frame (y up,
 * gravity-aligned, metres). The QR knows the same point in the model's frame
 * and which way that wall face looks (`rumbo`). Both frames are y up and in
 * metres, so one turn about the vertical and one shift line them up.
 */

export interface Colocacion {
  /** Turn about the vertical, radians (three.js rotation.y). */
  giro: number;
  /** Where the model's origin goes in the AR frame. */
  traslado: Vec3;
}

/** A hit counts as a wall when its normal is within this of horizontal. */
export const TOL_MURO_GRADOS = 15;

/** Whether a surface normal (y up) is a wall's. */
export function esMuroAR(normal: Vec3, tolGrados = TOL_MURO_GRADOS): boolean {
  const largo = Math.hypot(...normal);
  if (largo < 1e-9) return false;
  return Math.abs(normal[1] / largo) <= Math.sin((tolGrados * Math.PI) / 180);
}

/** Direction of a horizontal vector, from +z towards +x (the convention of `rumbo`). */
const direccion = (v: Vec3) => Math.atan2(v[0], v[2]);

/** Turns a point about the vertical by `giro` (same as three.js rotation.y). */
export function girar(p: Vec3, giro: number): Vec3 {
  const c = Math.cos(giro);
  const s = Math.sin(giro);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/**
 * The turn and shift that put the model's `puntoModelo` on `puntoAR` with its
 * wall face (`rumbo`) looking where the real wall's `normalAR` looks.
 */
export function calibrar(puntoModelo: Vec3, rumbo: number, puntoAR: Vec3, normalAR: Vec3): Colocacion {
  const giro = normalizar(direccion(normalAR) - rumbo);
  const girado = girar(puntoModelo, giro);
  return { giro, traslado: [puntoAR[0] - girado[0], puntoAR[1] - girado[1], puntoAR[2] - girado[2]] };
}

/** An AR point back in the model's frame (to know where one stands in the model). */
export function aModelo(puntoAR: Vec3, c: Colocacion): Vec3 {
  return girar([puntoAR[0] - c.traslado[0], puntoAR[1] - c.traslado[1], puntoAR[2] - c.traslado[2]], -c.giro);
}

/** Angle in (-π, π]. */
export function normalizar(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/** The normal (y axis) and position of a WebXR pose matrix (column-major 4×4). */
export function deMatriz(m: ArrayLike<number>): { punto: Vec3; normal: Vec3 } {
  return { punto: [m[12], m[13], m[14]], normal: [m[4], m[5], m[6]] };
}

/**
 * The QR's code from what a scanner read: only links to this app's phone page
 * are accepted, so a foreign QR never takes the phone elsewhere.
 */
export function codigoDeLectura(texto: string, origenesValidos: string[]): string | null {
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return null;
  }
  if (!origenesValidos.includes(url.origin)) return null;
  const m = /^\/ra\/q\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}
