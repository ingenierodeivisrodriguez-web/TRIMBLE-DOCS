// The cumulative information level: an element required at NDI-2 must have
// every parameter assigned to it whose level (its own, or the catalog's) is
// 1 or 2.
import { NDI_MAX, NDI_MIN, type Ndi, type NivelNdi, type Parametro, type ParametroExigido, type Plantilla, type ReglaValor } from "./types";

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

export interface ConteoNdi {
  obligatorios: number;
  opcionales: number;
}

/**
 * How many parameters of each level an element has (obligatory / optional),
 * for its summary: every level given, plus any other the element uses, from
 * the lowest.
 */
export function conteoPorNdi(asignados: ParametroExigido[], catalogo: Map<string, Parametro>, niveles: Ndi[]): Map<Ndi, ConteoNdi> {
  const conteo = new Map<Ndi, ConteoNdi>(niveles.map((n) => [n, { obligatorios: 0, opcionales: 0 }]));
  for (const a of asignados) {
    const p = catalogo.get(a.parametroId);
    if (!p || !p.activo) continue;
    const n = ndiDe(a, p);
    const c = conteo.get(n) ?? { obligatorios: 0, opcionales: 0 };
    c[a.obligatorio ? "obligatorios" : "opcionales"]++;
    conteo.set(n, c);
  }
  return new Map([...conteo].sort((a, b) => a[0] - b[0]));
}

/**
 * The catalog's level numbers plus those in use that it doesn't have (a
 * project that changed its base may keep them), from the lowest: what a
 * menu offers without hiding the current value.
 */
export function nivelesCon(niveles: NivelNdi[], ...enUso: (Ndi | null | undefined)[]): Ndi[] {
  const numeros = new Set(niveles.map((n) => n.numero));
  for (const n of enUso) if (n !== null && n !== undefined) numeros.add(n);
  return [...numeros].sort((a, b) => a - b);
}

/** "NDI-2 · Diseño", "NDI-2" (no name) or "NDI-4 (no configurado)". */
export function nombreNdi(n: Ndi, niveles: NivelNdi[]): string {
  const nivel = niveles.find((x) => x.numero === n);
  if (!nivel) return `NDI-${n} (no configurado)`;
  return nivel.nombre ? `NDI-${n} · ${nivel.nombre}` : `NDI-${n}`;
}

/** The numbers from 1 to 9 the catalog doesn't use yet, from the lowest. */
export function nivelesLibres(niveles: NivelNdi[]): Ndi[] {
  const libres: Ndi[] = [];
  for (let n = NDI_MIN; n <= NDI_MAX; n++) if (!niveles.some((x) => x.numero === n)) libres.push(n);
  return libres;
}

export interface UsosNivel {
  parametros: number;
  elementos: number;
  plantillas: number;
  celdas: number;
}

/**
 * Where the levels about to be taken out are still used: parameters of the
 * catalog (active or not), elements with a level of their own for some
 * parameter, templates (their elements) and matrix cells.
 */
export function usosDeNiveles(
  quitados: Set<Ndi>,
  d: { parametros: Parametro[]; elementos: { parametros: ParametroExigido[] }[]; plantillas: Plantilla[]; celdas: { ndi: Ndi | null }[] }
): Map<Ndi, UsosNivel> {
  const usos = new Map<Ndi, UsosNivel>();
  const de = (n: Ndi) => {
    let u = usos.get(n);
    if (!u) usos.set(n, (u = { parametros: 0, elementos: 0, plantillas: 0, celdas: 0 }));
    return u;
  };
  const propios = (exigidos: ParametroExigido[]) => new Set(exigidos.flatMap((a) => (a.ndi !== null && quitados.has(a.ndi) ? [a.ndi] : [])));
  for (const p of d.parametros) if (quitados.has(p.ndi)) de(p.ndi).parametros++;
  for (const e of d.elementos) for (const n of propios(e.parametros)) de(n).elementos++;
  for (const t of d.plantillas) for (const n of new Set(t.contenido.elementos.flatMap((e) => [...propios(e.parametros)]))) de(n).plantillas++;
  for (const c of d.celdas) if (c.ndi !== null && quitados.has(c.ndi)) de(c.ndi).celdas++;
  return new Map([...usos].sort((a, b) => a[0] - b[0]));
}

/** "3 parámetro(s) del catálogo, 2 elemento(s) y 5 celda(s) de la matriz". */
export function textoUsos(u: UsosNivel): string {
  const partes = [
    u.parametros ? `${u.parametros} parámetro(s) del catálogo` : "",
    u.elementos ? `${u.elementos} elemento(s) (con un NDI propio en algún parámetro)` : "",
    u.plantillas ? `${u.plantillas} plantilla(s)` : "",
    u.celdas ? `${u.celdas} celda(s) de la matriz` : "",
  ].filter(Boolean);
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : (partes[0] ?? "");
}

/** Adds the catalog's parameters of a TDI group and level that the element doesn't have yet (obligatory). */
export function agregarGrupo(asignados: ParametroExigido[], parametros: Parametro[], tdi: string, ndi: Ndi): ParametroExigido[] {
  const ya = new Set(asignados.map((a) => a.parametroId));
  const nuevos = parametros
    .filter((p) => p.activo && p.tdi === tdi && p.ndi === ndi && !ya.has(p.id))
    .map((p) => ({ parametroId: p.id, obligatorio: true, ndi: null, regla: null }));
  return [...asignados, ...nuevos];
}
