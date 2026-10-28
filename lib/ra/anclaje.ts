import type { ModeloRA, Vec3 } from "./modelo";

/**
 * Turning a point clicked in Trimble Connect's 3D viewer into the prepared
 * model's own frame (phase 2: where the QR goes).
 *
 * The viewer is z-up and its origin and units are its own (the model's
 * placement, possible shifts). The prepared model is y-up, in metres, relative
 * to its origin. Instead of guessing, the element under the click links both:
 * its box in the viewer and its box in the prepared model (same IFCGUID) give
 * the scale and the shift. If the two boxes do not have the same shape, the
 * model is turned or different in the viewer and the point is refused.
 */

export interface Caja {
  min: Vec3;
  max: Vec3;
}

export interface Alineacion {
  /** Viewer units → metres (1 or 0.001). */
  escala: number;
  /** Added after scaling, in the model's z-up frame relative to its origin. */
  traslado: Vec3;
}

/** Tolerance when comparing the two boxes: 3 cm or 2 % of the size, whichever is larger. */
const TOL_M = 0.03;
const TOL_REL = 0.02;
/** Two clicks must agree on the shift within this. */
export const TOL_ENTRE_PUNTOS = 0.05;
/** Arrow points closer than this do not give a reliable direction. */
export const DISTANCIA_MIN_FLECHA = 0.5;

/** Model frame (y up) → z-up frame, both relative to the origin. */
export const aZArriba = (p: Vec3): Vec3 => [p[0], -p[2], p[1]];
/** z-up frame → model frame (y up). */
export const aYArriba = (r: Vec3): Vec3 => [r[0], r[2], -r[1]];

/** The box of one element (by IFCGUID) in the model's frame, or null if it is not in it. */
export function cajaElemento(m: ModeloRA, guid: string): Caja | null {
  const indice = m.elementos.findIndex((e) => e.guid === guid);
  if (indice < 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const l of m.lotes) {
    for (let t = 0; t < l.tramos.length; t += 3) {
      if (l.tramos[t] !== indice) continue;
      const desde = l.tramos[t + 1];
      const hasta = desde + l.tramos[t + 2];
      for (let i = desde; i < hasta; i++) {
        const v = l.indices[i] * 3;
        for (let e = 0; e < 3; e++) {
          const c = l.posiciones[v + e];
          if (c < min[e]) min[e] = c;
          if (c > max[e]) max[e] = c;
        }
      }
    }
  }
  return min[0] === Infinity ? null : { min, max };
}

const tamano = (c: Caja): Vec3 => [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
const centro = (c: Caja): Vec3 => [(c.max[0] + c.min[0]) / 2, (c.max[1] + c.min[1]) / 2, (c.max[2] + c.min[2]) / 2];

/** The box of the model's frame, turned z-up (min/max recomputed since y flips). */
export function cajaZArriba(c: Caja): Caja {
  const a = aZArriba(c.min);
  const b = aZArriba(c.max);
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
}

export type ResultadoAlineacion = { ok: true; alineacion: Alineacion } | { ok: false; motivo: string };

/**
 * Scale and shift that take the element's viewer box onto its model box
 * (`cajaModelo` in the model's y-up frame).
 */
export function alinear(cajaVisor: Caja, cajaModelo: Caja): ResultadoAlineacion {
  const zm = cajaZArriba(cajaModelo);
  const tm = tamano(zm);
  const tv = tamano(cajaVisor);
  const mayorM = Math.max(...tm);
  const mayorV = Math.max(...tv);
  if (mayorM <= 0 || mayorV <= 0) return { ok: false, motivo: "El elemento tocado no tiene tamaño medible." };
  // Viewer in metres or millimetres: take whichever is closer.
  const escala = [1, 0.001].reduce((a, b) => (Math.abs(Math.log((mayorV * b) / mayorM)) < Math.abs(Math.log((mayorV * a) / mayorM)) ? b : a));
  for (let e = 0; e < 3; e++) {
    const diferencia = Math.abs(tv[e] * escala - tm[e]);
    if (diferencia > Math.max(TOL_M, TOL_REL * mayorM)) {
      return {
        ok: false,
        motivo: "El elemento tocado no tiene la misma forma en el visor y en el modelo preparado (el modelo está girado o cambió). Toque otro elemento o vuelva a preparar el modelo.",
      };
    }
  }
  const cv = centro(cajaVisor);
  const cm = centro(zm);
  return { ok: true, alineacion: { escala, traslado: [cm[0] - cv[0] * escala, cm[1] - cv[1] * escala, cm[2] - cv[2] * escala] } };
}

/** A viewer point in the model's frame (y up, metres, relative to the origin). */
export function puntoEnModelo(p: Vec3, a: Alineacion): Vec3 {
  return aYArriba([p[0] * a.escala + a.traslado[0], p[1] * a.escala + a.traslado[1], p[2] * a.escala + a.traslado[2]]);
}

/** Whether two alignments (from two clicks) agree. */
export function concuerdan(a: Alineacion, b: Alineacion): boolean {
  return a.escala === b.escala && Math.hypot(a.traslado[0] - b.traslado[0], a.traslado[1] - b.traslado[1], a.traslado[2] - b.traslado[2]) <= TOL_ENTRE_PUNTOS;
}

/**
 * Direction of the arrow on the floor, in radians, measured in the model's
 * frame from +z towards +x (the same convention the phone uses to turn the
 * model). Height is ignored.
 */
export function rumbo(desde: Vec3, hacia: Vec3): number {
  return Math.atan2(hacia[0] - desde[0], hacia[2] - desde[2]);
}

/** A readable name for an element of the model (its name, or its class). */
export function nombreElemento(m: ModeloRA, guid: string): string {
  const e = m.elementos.find((x) => x.guid === guid);
  return e ? e.nombre || e.clase : "";
}


/**
 * A model point as IFC coordinates in metres (x, y, z with z up), so a
 * surveyor can stake it on site.
 */
export function coordenadasIfc(punto: Vec3, origen: Vec3): Vec3 {
  return [punto[0] + origen[0], -(punto[2] + origen[2]), punto[1] + origen[1]];
}

export interface Toque {
  posicion: Vec3;
  modelId: string;
  runtimeId: number;
}

/** The "viewer.onPicked" payload (bare or wrapped in { data }), or null when it is not a click on an object. */
export function leerToque(data: unknown): Toque | null {
  const d = ((data as { data?: unknown } | null)?.data ?? data) as { position?: { x?: unknown; y?: unknown; z?: unknown }; modelId?: unknown; objectRuntimeId?: unknown } | null;
  const p = d?.position;
  if (!p || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.z !== "number") return null;
  if (typeof d.modelId !== "string" || typeof d.objectRuntimeId !== "number") return null;
  return { posicion: [p.x, p.y, p.z], modelId: d.modelId, runtimeId: d.objectRuntimeId };
}
