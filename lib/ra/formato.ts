import type { ElementoRA, LoteRA, ModeloRA, Rgba, Vec3 } from "./modelo";

/**
 * The file the phone downloads ("RAQ1"), gzip-compressed:
 *   "RAQ1" · u32 header length · header JSON (padded to 4 bytes) · per batch:
 *   positions f32 · normals i8 (padded to 4) · indices u32 · ranges u32.
 * Little-endian. Element texts go once in tables (classes, levels) in the header.
 */

const MAGIA = "RAQ1";
export const VERSION_FORMATO = 1;

interface Cabecera {
  version: number;
  origen: Vec3;
  min: Vec3;
  max: Vec3;
  triangulos: number;
  clases: string[];
  niveles: string[];
  /** [guid, class index, name, level index, file index] */
  elementos: [string, number, string, number, number][];
  lotes: { color: Rgba; vertices: number; indices: number; tramos: number }[];
}

const pad4 = (n: number) => (n + 3) & ~3;

export function empaquetar(m: ModeloRA): Uint8Array {
  const clases: string[] = [];
  const niveles: string[] = [];
  const indiceDe = (tabla: string[], mapa: Map<string, number>, v: string) => {
    let i = mapa.get(v);
    if (i === undefined) {
      i = tabla.push(v) - 1;
      mapa.set(v, i);
    }
    return i;
  };
  const mClases = new Map<string, number>();
  const mNiveles = new Map<string, number>();
  const cab: Cabecera = {
    version: VERSION_FORMATO,
    origen: m.origen,
    min: m.min,
    max: m.max,
    triangulos: m.triangulos,
    clases,
    niveles,
    elementos: m.elementos.map((e) => [e.guid, indiceDe(clases, mClases, e.clase), e.nombre, indiceDe(niveles, mNiveles, e.nivel), e.archivo]),
    lotes: m.lotes.map((l) => ({ color: l.color, vertices: l.posiciones.length / 3, indices: l.indices.length, tramos: l.tramos.length / 3 })),
  };
  const json = new TextEncoder().encode(JSON.stringify(cab));
  let total = 8 + pad4(json.length);
  for (const l of m.lotes) total += l.posiciones.byteLength + pad4(l.normales.byteLength) + l.indices.byteLength + l.tramos.byteLength;

  const out = new Uint8Array(total);
  const vista = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIA), 0);
  vista.setUint32(4, json.length, true);
  out.set(json, 8);
  let p = 8 + pad4(json.length);
  const poner = (arr: Float32Array | Int8Array | Uint32Array) => {
    // Copy as bytes; typed arrays are little-endian on every phone and PC we target.
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), p);
    p += pad4(arr.byteLength);
  };
  for (const l of m.lotes) {
    poner(l.posiciones);
    poner(l.normales);
    poner(l.indices);
    poner(l.tramos);
  }
  return out;
}

export function desempaquetar(datos: Uint8Array): ModeloRA {
  if (datos.length < 8 || new TextDecoder().decode(datos.subarray(0, 4)) !== MAGIA) throw new Error("El archivo no es un modelo de realidad aumentada.");
  // Work on an aligned copy so the typed arrays below can view it directly.
  const buf = datos.byteOffset % 4 === 0 ? datos : datos.slice();
  const vista = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const largo = vista.getUint32(4, true);
  const cab = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + largo))) as Cabecera;
  if (cab.version !== VERSION_FORMATO) throw new Error(`Versión de modelo ${cab.version} no soportada; vuelva a prepararlo.`);
  let p = buf.byteOffset + 8 + pad4(largo);
  const fin = buf.byteOffset + buf.byteLength;
  const tomar = <T>(Tipo: { new (b: ArrayBufferLike, o: number, n: number): T; BYTES_PER_ELEMENT: number }, n: number): T => {
    const bytes = n * Tipo.BYTES_PER_ELEMENT;
    if (p + bytes > fin) throw new Error("El archivo del modelo está incompleto.");
    const arr = new Tipo(buf.buffer, p, n);
    p += pad4(bytes);
    return arr;
  };
  const lotes: LoteRA[] = cab.lotes.map((l) => ({
    color: l.color,
    posiciones: tomar(Float32Array, l.vertices * 3),
    normales: tomar(Int8Array, l.vertices * 3),
    indices: tomar(Uint32Array, l.indices),
    tramos: tomar(Uint32Array, l.tramos * 3),
  }));
  const elementos: ElementoRA[] = cab.elementos.map(([guid, c, nombre, n, archivo]) => ({ guid, clase: cab.clases[c], nombre, nivel: cab.niveles[n], archivo }));
  return { origen: cab.origen, min: cab.min, max: cab.max, triangulos: cab.triangulos, elementos, lotes };
}

async function porFlujo(datos: Uint8Array, flujo: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const salida = new Blob([datos as BlobPart]).stream().pipeThrough(flujo);
  return new Uint8Array(await new Response(salida).arrayBuffer());
}

export const comprimir = (datos: Uint8Array) => porFlujo(datos, new CompressionStream("gzip"));
export const descomprimir = (datos: Uint8Array) => porFlujo(datos, new DecompressionStream("gzip"));
