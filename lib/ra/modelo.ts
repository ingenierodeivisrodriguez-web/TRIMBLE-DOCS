import type { IfcAPI } from "web-ifc";

/**
 * Turns IFC files into the light model the phone shows (phase 1 of the AR extension).
 *
 * Frame: web-ifc's, in metres with y up (IFC x → x, IFC z → y, IFC y → -z).
 * Positions are kept relative to `origen` (whole metres) so that Float32 does
 * not lose millimetres in georeferenced models far from the origin.
 *
 * Reading (`leerArchivo`, needs web-ifc) and building (`armarModelo`, pure) are
 * apart: the person picks levels and classes between the two without reading
 * the IFC again.
 */

export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];

/** The part of web-ifc's IfcAPI used here (a fake one in tests is possible). */
export type ApiIfc = Pick<
  IfcAPI,
  "StreamAllMeshes" | "GetGeometry" | "GetVertexArray" | "GetIndexArray" | "GetLine" | "GetLineType" | "GetNameFromTypeCode" | "GetLineIDsWithType"
>;

// IFC entity type codes (web-ifc's constants; a test checks they match).
export const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617779;
export const IFCRELAGGREGATES = 160246688;
export const IFCBUILDINGSTOREY = 3124254112;

export const SIN_NIVEL = "Sin nivel";

export interface Pieza {
  color: Rgba;
  /** xyz relative to the origin. */
  posiciones: Float32Array;
  /** xyz unit normals. */
  normales: Float32Array;
  indices: Uint32Array;
}

export interface ElementoLeido {
  guid: string;
  clase: string;
  nombre: string;
  nivel: string;
  /** Index of the file it came from. */
  archivo: number;
  piezas: Pieza[];
  triangulos: number;
}

export interface ArchivoLeido {
  origen: Vec3;
  elementos: ElementoLeido[];
}

export interface ElementoRA {
  guid: string;
  clase: string;
  nombre: string;
  nivel: string;
  archivo: number;
}

/** One draw call on the phone: every piece of one colour, merged. */
export interface LoteRA {
  color: Rgba;
  posiciones: Float32Array;
  /** Normals ×127, for a normalized Int8 attribute. */
  normales: Int8Array;
  indices: Uint32Array;
  /** Triples [element index, first index, index count]: which triangles are whose. */
  tramos: Uint32Array;
}

export interface ModeloRA {
  origen: Vec3;
  /** Bounding box relative to the origin. */
  min: Vec3;
  max: Vec3;
  elementos: ElementoRA[];
  lotes: LoteRA[];
  triangulos: number;
}

export interface Filtros {
  nivelesExcluidos: string[];
  clasesExcluidas: string[];
}

/** Classes left out unless someone asks for them: they get in the way when walking inside. */
export const CLASES_EXCLUIDAS_INICIALES = ["IfcSpace", "IfcOpeningElement", "IfcVirtualElement", "IfcAnnotation"];

const texto = (v: unknown): string => {
  const valor = (v as { value?: unknown } | null | undefined)?.value;
  return typeof valor === "string" ? valor : "";
};
const ids = (v: unknown): number[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => (x as { value?: unknown })?.value).filter((x): x is number => typeof x === "number");

/** Which storey each element is on: contained directly, or through what it is part of. */
function niveles(api: ApiIfc, modelID: number): (expressID: number) => string {
  const contenedor = new Map<number, number>();
  const padre = new Map<number, number>();
  const leerRel = (tipo: number, cada: (linea: Record<string, unknown>) => void) => {
    const lista = api.GetLineIDsWithType(modelID, tipo);
    for (let i = 0; i < lista.size(); i++) cada(api.GetLine(modelID, lista.get(i)) as Record<string, unknown>);
  };
  leerRel(IFCRELCONTAINEDINSPATIALSTRUCTURE, (r) => {
    const [estructura] = ids(r.RelatingStructure);
    if (estructura !== undefined) for (const e of ids(r.RelatedElements)) contenedor.set(e, estructura);
  });
  leerRel(IFCRELAGGREGATES, (r) => {
    const [todo] = ids(r.RelatingObject);
    if (todo !== undefined) for (const parte of ids(r.RelatedObjects)) padre.set(parte, todo);
  });
  const nombres = new Map<number, string>();
  const nombreNivel = (id: number) => {
    let n = nombres.get(id);
    if (n === undefined) {
      const linea = api.GetLine(modelID, id) as Record<string, unknown>;
      n = texto(linea.Name) || texto(linea.LongName) || `Nivel #${id}`;
      nombres.set(id, n);
    }
    return n;
  };
  const cache = new Map<number, string>();
  return function nivelDe(id: number): string {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    let resultado = SIN_NIVEL;
    // Climb element → container or whole it belongs to → … until a storey (bounded against loops).
    let actual: number | undefined = id;
    for (let paso = 0; actual !== undefined && paso < 50; paso++) {
      if (paso > 0 && api.GetLineType(modelID, actual) === IFCBUILDINGSTOREY) {
        resultado = nombreNivel(actual);
        break;
      }
      actual = contenedor.get(actual) ?? padre.get(actual);
    }
    cache.set(id, resultado);
    return resultado;
  };
}

/**
 * Reads every element with geometry of an open IFC model. `origen`: the one of
 * a file already read (all files of a model share it); without it, the first
 * vertex rounded to whole metres.
 */
export function leerArchivo(api: ApiIfc, modelID: number, archivo: number, origen?: Vec3, alAvanzar?: (hechos: number, total: number) => void): ArchivoLeido {
  const nivelDe = niveles(api, modelID);
  const elementos = new Map<number, ElementoLeido>();
  let o = origen;
  api.StreamAllMeshes(modelID, (mesh, indice, total) => {
    const id = mesh.expressID;
    let el = elementos.get(id);
    if (!el) {
      const linea = api.GetLine(modelID, id) as Record<string, unknown>;
      el = { guid: texto(linea.GlobalId), clase: api.GetNameFromTypeCode(api.GetLineType(modelID, id)), nombre: texto(linea.Name), nivel: nivelDe(id), archivo, piezas: [], triangulos: 0 };
      elementos.set(id, el);
    }
    const geometrias = mesh.geometries;
    for (let i = 0; i < geometrias.size(); i++) {
      const pg = geometrias.get(i);
      const geo = api.GetGeometry(modelID, pg.geometryExpressID);
      const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
      const indices = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize()).slice();
      const m = pg.flatTransformation;
      const n = v.length / 6;
      if (!o && n > 0) {
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        o = [Math.round(x), Math.round(y), Math.round(z)];
      }
      const [ox, oy, oz] = o ?? [0, 0, 0];
      const posiciones = new Float32Array(n * 3);
      const normales = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const px = v[k * 6], py = v[k * 6 + 1], pz = v[k * 6 + 2];
        const nx = v[k * 6 + 3], ny = v[k * 6 + 4], nz = v[k * 6 + 5];
        // Translate in double precision, then subtract the origin, then store as float.
        posiciones[k * 3] = m[0] * px + m[4] * py + m[8] * pz + m[12] - ox;
        posiciones[k * 3 + 1] = m[1] * px + m[5] * py + m[9] * pz + m[13] - oy;
        posiciones[k * 3 + 2] = m[2] * px + m[6] * py + m[10] * pz + m[14] - oz;
        const rx = m[0] * nx + m[4] * ny + m[8] * nz;
        const ry = m[1] * nx + m[5] * ny + m[9] * nz;
        const rz = m[2] * nx + m[6] * ny + m[10] * nz;
        const largo = Math.hypot(rx, ry, rz) || 1;
        normales[k * 3] = rx / largo;
        normales[k * 3 + 1] = ry / largo;
        normales[k * 3 + 2] = rz / largo;
      }
      const c = pg.color;
      el.piezas.push({ color: [c.x, c.y, c.z, c.w], posiciones, normales, indices });
      el.triangulos += indices.length / 3;
      geo.delete();
    }
    alAvanzar?.(indice + 1, total);
  });
  return { origen: o ?? [0, 0, 0], elementos: [...elementos.values()].filter((e) => e.triangulos > 0) };
}

export interface Conteo {
  nombre: string;
  elementos: number;
  triangulos: number;
}

/** Levels and classes found, with how many elements and triangles each has (for the filter). */
export function inventario(archivos: ArchivoLeido[]): { niveles: Conteo[]; clases: Conteo[] } {
  const sumar = (mapa: Map<string, Conteo>, nombre: string, triangulos: number) => {
    const c = mapa.get(nombre) ?? { nombre, elementos: 0, triangulos: 0 };
    c.elementos++;
    c.triangulos += triangulos;
    mapa.set(nombre, c);
  };
  const niveles = new Map<string, Conteo>();
  const clases = new Map<string, Conteo>();
  for (const a of archivos) {
    for (const e of a.elementos) {
      sumar(niveles, e.nivel, e.triangulos);
      sumar(clases, e.clase, e.triangulos);
    }
  }
  const orden = (x: Conteo, y: Conteo) => (x.nombre === SIN_NIVEL ? 1 : y.nombre === SIN_NIVEL ? -1 : x.nombre.localeCompare(y.nombre, "es", { numeric: true }));
  return { niveles: [...niveles.values()].sort(orden), clases: [...clases.values()].sort(orden) };
}

/** Triangles left once the filter applies (to warn before building). */
export function triangulosCon(archivos: ArchivoLeido[], filtros: Filtros): number {
  const fuera = filtroDe(filtros);
  return archivos.reduce((s, a) => s + a.elementos.reduce((t, e) => t + (fuera(e) ? 0 : e.triangulos), 0), 0);
}

function filtroDe(filtros: Filtros): (e: ElementoLeido) => boolean {
  const niveles = new Set(filtros.nivelesExcluidos);
  const clases = new Set(filtros.clasesExcluidas);
  return (e) => niveles.has(e.nivel) || clases.has(e.clase);
}

const claveColor = (c: Rgba) => c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)).join(",");

/** Merges the chosen elements into one batch per colour. */
export function armarModelo(archivos: ArchivoLeido[], filtros: Filtros): ModeloRA {
  if (!archivos.length) throw new Error("No hay archivos leídos.");
  const fuera = filtroDe(filtros);
  const elementos: ElementoRA[] = [];
  type Junta = { color: Rgba; piezas: { elemento: number; pieza: Pieza }[]; vertices: number; indices: number };
  const juntas = new Map<string, Junta>();
  const origen = archivos[0].origen;
  for (const a of archivos) {
    // Files read with another origin are moved onto the first one's.
    const dx = a.origen[0] - origen[0], dy = a.origen[1] - origen[1], dz = a.origen[2] - origen[2];
    const mover = dx !== 0 || dy !== 0 || dz !== 0;
    for (const e of a.elementos) {
      if (fuera(e)) continue;
      const indice = elementos.length;
      elementos.push({ guid: e.guid, clase: e.clase, nombre: e.nombre, nivel: e.nivel, archivo: e.archivo });
      for (const p of e.piezas) {
        let pieza = p;
        if (mover) {
          const pos = new Float32Array(p.posiciones.length);
          for (let k = 0; k < pos.length; k += 3) {
            pos[k] = p.posiciones[k] + dx;
            pos[k + 1] = p.posiciones[k + 1] + dy;
            pos[k + 2] = p.posiciones[k + 2] + dz;
          }
          pieza = { ...p, posiciones: pos };
        }
        const clave = claveColor(p.color);
        const j = juntas.get(clave) ?? { color: p.color, piezas: [], vertices: 0, indices: 0 };
        j.piezas.push({ elemento: indice, pieza });
        j.vertices += pieza.posiciones.length / 3;
        j.indices += pieza.indices.length;
        juntas.set(clave, j);
      }
    }
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangulos = 0;
  const lotes: LoteRA[] = [];
  for (const j of juntas.values()) {
    const posiciones = new Float32Array(j.vertices * 3);
    const normales = new Int8Array(j.vertices * 3);
    const indices = new Uint32Array(j.indices);
    const tramos: number[] = [];
    let v0 = 0;
    let i0 = 0;
    for (const { elemento, pieza } of j.piezas) {
      posiciones.set(pieza.posiciones, v0 * 3);
      for (let k = 0; k < pieza.normales.length; k++) normales[v0 * 3 + k] = Math.round(Math.max(-1, Math.min(1, pieza.normales[k])) * 127);
      for (let k = 0; k < pieza.indices.length; k++) indices[i0 + k] = pieza.indices[k] + v0;
      for (let k = 0; k < pieza.posiciones.length; k += 3) {
        for (let eje = 0; eje < 3; eje++) {
          const c = pieza.posiciones[k + eje];
          if (c < min[eje]) min[eje] = c;
          if (c > max[eje]) max[eje] = c;
        }
      }
      // Consecutive pieces of the same element share one range.
      const ultimo = tramos.length - 3;
      if (ultimo >= 0 && tramos[ultimo] === elemento && tramos[ultimo + 1] + tramos[ultimo + 2] === i0) tramos[ultimo + 2] += pieza.indices.length;
      else tramos.push(elemento, i0, pieza.indices.length);
      v0 += pieza.posiciones.length / 3;
      i0 += pieza.indices.length;
    }
    triangulos += indices.length / 3;
    lotes.push({ color: j.color, posiciones, normales, indices, tramos: Uint32Array.from(tramos) });
  }
  if (!elementos.length) {
    return { origen, min: [0, 0, 0], max: [0, 0, 0], elementos, lotes, triangulos: 0 };
  }
  return { origen, min, max, elementos, lotes, triangulos };
}

/** The element a triangle belongs to (face index within a batch), or -1. */
export function elementoDeTriangulo(lote: LoteRA, triangulo: number): number {
  const indice = triangulo * 3;
  let a = 0;
  let b = lote.tramos.length / 3 - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    const desde = lote.tramos[m * 3 + 1];
    const cuantos = lote.tramos[m * 3 + 2];
    if (indice < desde) b = m - 1;
    else if (indice >= desde + cuantos) a = m + 1;
    else return lote.tramos[m * 3];
  }
  return -1;
}
