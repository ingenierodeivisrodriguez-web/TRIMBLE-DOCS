import { ServiceError } from "../propiedades/service";
import { BYTES_MAX, TRIANGULOS_MAX } from "./limites";
import type { ArchivoFuente, NuevoModelo } from "./types";

/** Everything the browser sends about a new model, checked. */

const ID_TRIMBLE = /^[A-Za-z0-9_-]{1,64}$/;

const mal = (texto: string) => new ServiceError(texto, 400, "invalido");

function textoCorto(v: unknown, campo: string, max: number, vacio = false): string {
  if (typeof v !== "string") throw mal(`Falta ${campo}.`);
  const t = v.trim();
  if (!t && !vacio) throw mal(`Falta ${campo}.`);
  if (t.length > max) throw mal(`${campo[0].toUpperCase()}${campo.slice(1)} es demasiado largo (máximo ${max} caracteres).`);
  return t;
}

function entero(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw mal(`El valor de ${campo} no es válido (entre ${min} y ${max}).`);
  return v;
}

function listaTextos(v: unknown, campo: string, maxItems: number): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems) throw mal(`La lista de ${campo} no es válida.`);
  return [...new Set(v.map((x) => textoCorto(x, campo, 200)))];
}

export function validarDias(body: unknown): number {
  const dias = (body as { diasSinUso?: unknown } | null)?.diasSinUso;
  return entero(dias, "días sin uso", 1, 365);
}

export function validarNuevoModelo(body: unknown): NuevoModelo {
  if (!body || typeof body !== "object") throw mal("Faltan los datos del modelo.");
  const b = body as Record<string, unknown>;
  const nombre = textoCorto(b.nombre, "el nombre", 120);
  if (!Array.isArray(b.archivos) || b.archivos.length < 1 || b.archivos.length > 20) throw mal("Elija entre 1 y 20 archivos IFC.");
  const archivos: ArchivoFuente[] = b.archivos.map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    const fileId = textoCorto(x.fileId, "el archivo", 64);
    const versionId = textoCorto(x.versionId ?? "", "la versión", 64, true);
    if (!ID_TRIMBLE.test(fileId) || (versionId && !ID_TRIMBLE.test(versionId))) throw mal("El identificador de un archivo no es válido.");
    return { fileId, versionId, nombre: textoCorto(x.nombre, "el nombre del archivo", 255) };
  });
  const f = (b.filtros ?? {}) as Record<string, unknown>;
  const filtros = { nivelesExcluidos: listaTextos(f.nivelesExcluidos, "niveles", 1000), clasesExcluidas: listaTextos(f.clasesExcluidas, "clases", 500) };
  const origen = b.origen;
  if (!Array.isArray(origen) || origen.length !== 3 || !origen.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e9)) {
    throw mal("El origen del modelo no es válido.");
  }
  return {
    nombre,
    archivos,
    filtros,
    bytes: entero(b.bytes, "el tamaño", 1, BYTES_MAX),
    triangulos: entero(b.triangulos, "los triángulos", 1, TRIANGULOS_MAX),
    elementos: entero(b.elementos, "los elementos", 1, 10_000_000),
    origen: [origen[0], origen[1], origen[2]],
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarId(id: string): string {
  if (!UUID.test(id)) throw mal("El identificador del modelo no es válido.");
  return id;
}
