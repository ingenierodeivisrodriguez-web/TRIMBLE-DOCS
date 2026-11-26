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
