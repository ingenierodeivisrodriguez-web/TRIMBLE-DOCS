// The cumulative information level: an element required at NDI-2 must have
// every parameter assigned to it whose level (its own, or the catalog's) is
// 1 or 2.
import type { Ndi, Parametro, ParametroExigido, ReglaValor } from "./types";

export interface Exigencia {
  parametro: Parametro;
  obligatorio: boolean;
  ndi: Ndi;
  regla: ReglaValor;
}

/** The level a parameter has in an element: the element's own, or the catalog's. */
export function ndiDe(asignado: ParametroExigido, parametro: Parametro): Ndi {
  return asignado.ndi ?? parametro.ndi;
}

/**
 * What an element requires at a given level. Parameters missing from the
 * catalog or deactivated in it are left out (they appear as warnings in the
 * element's sheet).
 */
export function exigidosHasta(asignados: ParametroExigido[], catalogo: Map<string, Parametro>, nivel: Ndi): Exigencia[] {
  const out: Exigencia[] = [];
  for (const a of asignados) {
    const p = catalogo.get(a.parametroId);
    if (!p || !p.activo) continue;
    const ndi = ndiDe(a, p);
    if (ndi <= nivel) out.push({ parametro: p, obligatorio: a.obligatorio, ndi, regla: a.regla ?? p.regla });
  }
  return out;
}

/** How many parameters of each level an element has (obligatory / optional), for its summary. */
export function conteoPorNdi(asignados: ParametroExigido[], catalogo: Map<string, Parametro>): Record<Ndi, { obligatorios: number; opcionales: number }> {
  const conteo: Record<Ndi, { obligatorios: number; opcionales: number }> = {
    1: { obligatorios: 0, opcionales: 0 },
    2: { obligatorios: 0, opcionales: 0 },
    3: { obligatorios: 0, opcionales: 0 },
  };
  for (const a of asignados) {
    const p = catalogo.get(a.parametroId);
    if (!p || !p.activo) continue;
    conteo[ndiDe(a, p)][a.obligatorio ? "obligatorios" : "opcionales"]++;
  }
  return conteo;
}

/** Adds the catalog's parameters of a TDI group and level that the element doesn't have yet (obligatory). */
export function agregarGrupo(asignados: ParametroExigido[], parametros: Parametro[], tdi: string, ndi: Ndi): ParametroExigido[] {
  const ya = new Set(asignados.map((a) => a.parametroId));
  const nuevos = parametros
    .filter((p) => p.activo && p.tdi === tdi && p.ndi === ndi && !ya.has(p.id))
    .map((p) => ({ parametroId: p.id, obligatorio: true, ndi: null, regla: null }));
  return [...asignados, ...nuevos];
}
