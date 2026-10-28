/**
 * The test volume of phase 0: a box at 1:1 scale standing on the floor, in metres.
 * Local frame: origin at the centre of its base, y up, the front face looking to +z.
 */

export interface Medidas {
  ancho: number; // x
  largo: number; // z
  alto: number; // y
}

export type Punto = { x: number; y: number; z: number };

export const VOLUMEN_PRUEBA: Medidas = { ancho: 2, largo: 2, alto: 3 };

/** The 12 edges of the box, as pairs of corners. */
export function aristasCaja(m: Medidas): [Punto, Punto][] {
  const x = m.ancho / 2;
  const z = m.largo / 2;
  const base = [
    { x: -x, z: -z },
    { x: x, z: -z },
    { x: x, z: z },
    { x: -x, z: z },
  ];
  const aristas: [Punto, Punto][] = [];
  base.forEach((p, i) => {
    const q = base[(i + 1) % 4];
    aristas.push([{ x: p.x, y: 0, z: p.z }, { x: q.x, y: 0, z: q.z }]);
    aristas.push([{ x: p.x, y: m.alto, z: p.z }, { x: q.x, y: m.alto, z: q.z }]);
    aristas.push([{ x: p.x, y: 0, z: p.z }, { x: p.x, y: m.alto, z: p.z }]);
  });
  return aristas;
}

/** Floor lines every metre inside the base, so one can pace it and check the scale. */
export function cuadriculaPiso(m: Medidas, paso = 1): [Punto, Punto][] {
  const lineas: [Punto, Punto][] = [];
  const x = m.ancho / 2;
  const z = m.largo / 2;
  for (let d = -x + paso; d < x - 1e-9; d += paso) lineas.push([{ x: d, y: 0, z: -z }, { x: d, y: 0, z: z }]);
  for (let d = -z + paso; d < z - 1e-9; d += paso) lineas.push([{ x: -x, y: 0, z: d }, { x: x, y: 0, z: d }]);
  return lineas;
}

/**
 * Turn about the vertical (radians) that makes the box's front face the person
 * standing at `desde` when it is placed at `punto`.
 */
export function giroHaciaPersona(punto: { x: number; z: number }, desde: { x: number; z: number }): number {
  const dx = desde.x - punto.x;
  const dz = desde.z - punto.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(dx, dz);
}

/** Distance on the floor plan, ignoring height (how far one is from the anchor). */
export function distanciaEnPlanta(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Whether a point given in the box's local frame is inside its footprint. */
export function dentroEnPlanta(local: { x: number; z: number }, m: Medidas): boolean {
  return Math.abs(local.x) <= m.ancho / 2 && Math.abs(local.z) <= m.largo / 2;
}

/**
 * Whether a hit-test pose (4×4 column-major matrix) lies on a floor-like surface:
 * its local y axis points up within `toleranciaGrados`. Walls and ceilings are refused.
 */
export function esHorizontal(matriz: ArrayLike<number>, toleranciaGrados = 15): boolean {
  const largoEje = Math.hypot(matriz[4], matriz[5], matriz[6]);
  if (largoEje < 1e-9) return false;
  return matriz[5] / largoEje >= Math.cos((toleranciaGrados * Math.PI) / 180);
}

/** Metres with two decimals and a comma-free format, e.g. "3.20 m". */
export function metros(valor: number): string {
  return `${(Math.round(valor * 100) / 100).toFixed(2)} m`;
}
