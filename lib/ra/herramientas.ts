import type { LoteRA, ModeloRA, Rgba, Vec3 } from "./modelo";

/**
 * The phone's tools on the placed model (phase 4): horizontal and vertical
 * cuts, transparency and colouring by hand. Values the person sees are IFC
 * coordinates in metres (X, Y east/north, Z height); the scene works in the
 * model's own frame (y up, relative to its origin: IFC x → x, IFC z → y,
 * IFC y → -z).
 */

export type Eje = "x" | "y" | "z";

/** A cutting plane in the model's frame: keeps the points where normal·p + constante ≥ 0 (three.js clips the rest). */
export interface Plano {
  normal: Vec3;
  constante: number;
}

/** IFC coordinate of the model frame's point along an axis. */
export function cotaIfc(eje: Eje, p: Vec3, origen: Vec3): number {
  if (eje === "x") return p[0] + origen[0];
  if (eje === "y") return -(p[2] + origen[2]);
  return p[1] + origen[1];
}

/** The model's extent along an IFC axis, in IFC metres. */
export function rangoIfc(m: ModeloRA, eje: Eje): { min: number; max: number } {
  const a = cotaIfc(eje, m.min, m.origen);
  const b = cotaIfc(eje, m.max, m.origen);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * The plane that cuts at IFC coordinate `valor` along `eje`. By default it
 * keeps what is below (z) or before (x, y) the cut; `invertido` keeps the other side.
 */
export function planoCorte(eje: Eje, valor: number, origen: Vec3, invertido = false): Plano {
  // keep: IFC coordinate ≤ valor
  let plano: Plano;
  if (eje === "x") plano = { normal: [-1, 0, 0], constante: valor - origen[0] };
  else if (eje === "z") plano = { normal: [0, -1, 0], constante: valor - origen[1] };
  // IFC y = -(z + origen z) ≤ valor  ⇔  z + valor + origen z ≥ 0
  else plano = { normal: [0, 0, 1], constante: valor + origen[2] };
  return invertido ? { normal: [-plano.normal[0], -plano.normal[1], -plano.normal[2]], constante: -plano.constante } : plano;
}

/** Whether a model-frame point survives a cut. */
export function conserva(plano: Plano, p: Vec3): boolean {
  return plano.normal[0] * p[0] + plano.normal[1] * p[1] + plano.normal[2] * p[2] + plano.constante >= 0;
}

/** Opacity of a batch once the transparency slider (0 to 0.9) applies. */
export function opacidad(base: number, transparencia: number): number {
  const t = Math.min(0.9, Math.max(0, transparencia));
  return Math.round(base * (1 - t) * 1000) / 1000;
}

/**
 * The vertex ranges [from, to) of one element in a batch. An element's
 * vertices are contiguous per piece and never shared with another element,
 * so colouring these ranges colours exactly that element.
 */
export function rangosVertices(lote: LoteRA, elemento: number): [number, number][] {
  const rangos: [number, number][] = [];
  for (let t = 0; t < lote.tramos.length; t += 3) {
    if (lote.tramos[t] !== elemento) continue;
    const desde = lote.tramos[t + 1];
    const hasta = desde + lote.tramos[t + 2];
    let min = Infinity;
    let max = -Infinity;
    for (let i = desde; i < hasta; i++) {
      const v = lote.indices[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min <= max) rangos.push([min, max + 1]);
  }
  return rangos;
}

/** Colours for marking by hand: eight that tell apart on site, in a fixed order. */
export const PALETA: { nombre: string; rgb: [number, number, number] }[] = [
  { nombre: "Rojo", rgb: [0.86, 0.15, 0.15] },
  { nombre: "Naranja", rgb: [0.98, 0.5, 0.1] },
  { nombre: "Amarillo", rgb: [0.98, 0.84, 0.1] },
  { nombre: "Verde", rgb: [0.18, 0.62, 0.25] },
  { nombre: "Azul", rgb: [0.15, 0.39, 0.92] },
  { nombre: "Morado", rgb: [0.55, 0.25, 0.75] },
  { nombre: "Gris", rgb: [0.45, 0.47, 0.5] },
  { nombre: "Negro", rgb: [0.1, 0.1, 0.12] },
];

/** The colour a batch is shown with (pure white from the IFC reads as light grey). */
export function colorBase(c: Rgba): [number, number, number] {
  return c[0] > 0.98 && c[1] > 0.98 && c[2] > 0.98 ? [0.82, 0.83, 0.85] : [c[0], c[1], c[2]];
}

/** "1,002.50 m" for the cut sliders. */
export function cota(valor: number): string {
  return `${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/** What the tool bar has chosen; the scene follows it. */
export interface EstadoHerramientas {
  corteH: { activo: boolean; valor: number; invertido: boolean };
  corteV: { activo: boolean; eje: "x" | "y"; valor: number; invertido: boolean };
  /** 0 to 0.9. */
  transparencia: number;
  /** Colour index of PALETA, or null to take colours off; `activo` makes a tap colour. */
  colorear: { activo: boolean; color: number | null };
}

/**
 * Starting values: everything off; the horizontal cut ready at the QR's height
 * (about eye level, like a floor plan) and the vertical one at the model's middle.
 */
export function estadoInicial(m: ModeloRA, puntoQr?: Vec3): EstadoHerramientas {
  const z = rangoIfc(m, "z");
  const x = rangoIfc(m, "x");
  const alturaQr = puntoQr ? cotaIfc("z", puntoQr, m.origen) : (z.min + z.max) / 2;
  return {
    corteH: { activo: false, valor: Math.round(alturaQr * 100) / 100, invertido: false },
    corteV: { activo: false, eje: "x", valor: Math.round(((x.min + x.max) / 2) * 100) / 100, invertido: false },
    transparencia: 0,
    colorear: { activo: false, color: 0 },
  };
}

/** The cutting planes in force, in the model's frame. */
export function planosActivos(e: EstadoHerramientas, origen: Vec3): Plano[] {
  const planos: Plano[] = [];
  if (e.corteH.activo) planos.push(planoCorte("z", e.corteH.valor, origen, e.corteH.invertido));
  if (e.corteV.activo) planos.push(planoCorte(e.corteV.eje, e.corteV.valor, origen, e.corteV.invertido));
  return planos;
}
