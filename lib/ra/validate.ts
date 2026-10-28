import { ServiceError } from "../propiedades/service";
import { BYTES_MAX, TRIANGULOS_MAX } from "./limites";
import type { ArchivoFuente, NuevoModelo, NuevoPunto } from "./types";

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

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** A new QR point; `hoy` is today's date in Colombia ("AAAA-MM-DD"), `maxDias` how far it may expire. */
export function validarNuevoPunto(body: unknown, hoy: string, maxDias: number): NuevoPunto {
  if (!body || typeof body !== "object") throw mal("Faltan los datos del punto.");
  const b = body as Record<string, unknown>;
  const modeloId = validarId(typeof b.modeloId === "string" ? b.modeloId : "");
  const nombre = textoCorto(b.nombre, "el nombre del punto", 120);
  const referencia = textoCorto(b.referencia ?? "", "la referencia de la flecha", 200, true);
  if (!referencia) throw mal("Escriba hacia dónde apunta la flecha (por ejemplo, «hacia el eje B, paralela al muro de fachada»).");
  const elemento = textoCorto(b.elemento ?? "", "el elemento", 200, true);
  const punto = b.punto;
  if (!Array.isArray(punto) || punto.length !== 3 || !punto.every((x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e6)) {
    throw mal("El punto elegido no es válido.");
  }
  const rumbo = b.rumbo;
  if (typeof rumbo !== "number" || !Number.isFinite(rumbo) || Math.abs(rumbo) > Math.PI + 1e-9) throw mal("La dirección de la flecha no es válida.");
  const vence = typeof b.vence === "string" ? b.vence : "";
  const dia = new Date(`${vence}T12:00:00Z`);
  if (!FECHA.test(vence) || Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== vence) throw mal("La fecha de vencimiento no es válida.");
  const dias = Math.round((dia.getTime() - new Date(`${hoy}T12:00:00Z`).getTime()) / 86_400_000);
  if (dias < 0) throw mal("La fecha de vencimiento ya pasó.");
  if (dias > maxDias) throw mal(`El QR puede abrir como máximo ${maxDias} días; elija una fecha más cercana.`);
  return { modeloId, nombre, referencia, punto: [punto[0], punto[1], punto[2]], rumbo, elemento, vence };
}
