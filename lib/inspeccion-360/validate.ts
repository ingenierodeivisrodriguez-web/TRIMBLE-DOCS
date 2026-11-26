// Everything that comes from the browser is checked here before the service uses it.
import { ServiceError } from "../propiedades/service";
import { errorSegmento, normalizarSegmento } from "./codigos";
import { CambiosPunto, MAX_BYTES_FOTO, MAX_MINIATURA, NuevaSubida, NuevoPunto, Vec3 } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_TRIMBLE = /^[A-Za-z0-9_-]{1,64}$/;

const malo = (mensaje: string) => new ServiceError(mensaje, 400, "datos");
const objeto = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw malo("Los datos enviados no son válidos.");
  return body as Record<string, unknown>;
};
function texto(v: unknown, campo: string, max: number): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw malo(`${campo}: debe ser texto.`);
  const t = v.trim();
  if (t.length > max) throw malo(`${campo}: máximo ${max} caracteres.`);
  return t;
}
function numero(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw malo(`${campo}: debe ser un número entre ${min} y ${max}.`);
  return v;
}
function version(v: unknown): number {
  if (!Number.isInteger(v) || (v as number) < 0) throw malo("Falta la versión de lo que se está guardando.");
  return v as number;
}
function rumbo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const r = numero(v, "Rumbo", 0, 360);
  return r === 360 ? 0 : r;
}

export function validarId(id: string): string {
  if (!UUID.test(id)) throw malo("El identificador no es válido.");
  return id.toLowerCase();
}

export function validarConfig(body: unknown): { codigoProyecto: string | null; carpetaNombre: string | null; editores: string[]; version: number } {
  const b = objeto(body);
  let codigoProyecto: string | null = null;
  if (b.codigoProyecto !== undefined && b.codigoProyecto !== null && b.codigoProyecto !== "") {
    codigoProyecto = normalizarSegmento(String(b.codigoProyecto));
    const e = errorSegmento("proyecto", codigoProyecto);
    if (e) throw malo(e);
  }
  const carpeta = texto(b.carpetaNombre, "Carpeta del CDE", 120);
  if (carpeta && /[\\/:*?"<>|]/.test(carpeta)) throw malo("La carpeta del CDE no puede llevar \\ / : * ? \" < > |.");
  const editores = b.editores === undefined ? [] : b.editores;
  if (!Array.isArray(editores) || editores.length > 200 || editores.some((e) => typeof e !== "string" || !ID_TRIMBLE.test(e))) throw malo("La lista de editores no es válida.");
  return { codigoProyecto, carpetaNombre: carpeta || null, editores: [...new Set(editores as string[])], version: version(b.version) };
}

function segmento(v: unknown, parte: "torre" | "piso" | "unidad"): string {
  const s = normalizarSegmento(texto(v, parte, 40));
  const e = errorSegmento(parte, s);
  if (e) throw malo(e);
  return s;
}

export function validarNuevoPunto(body: unknown): NuevoPunto {
  const b = objeto(body);
  const p = b.piso3d;
  if (!Array.isArray(p) || p.length !== 3 || p.some((c) => typeof c !== "number" || !Number.isFinite(c) || Math.abs(c) > 1e9)) {
    throw malo("Falta el punto tocado en el modelo (x, y, z).");
  }
  const modelId = texto(b.modelId, "Modelo", 64);
  if (!ID_TRIMBLE.test(modelId)) throw malo("Falta el modelo donde se ubicó el punto.");
  const versionId = b.versionId ? texto(b.versionId, "Versión del modelo", 64) : null;
  if (versionId && !ID_TRIMBLE.test(versionId)) throw malo("La versión del modelo no es válida.");
  let n: number | undefined;
  if (b.numero !== undefined && b.numero !== null && b.numero !== "") {
    n = Number(b.numero);
    const e = errorSegmento("numero", n);
    if (e) throw malo(e);
  }
  return {
    torre: segmento(b.torre, "torre"),
    piso: segmento(b.piso, "piso"),
    unidad: segmento(b.unidad, "unidad"),
    numero: n,
    espacio: texto(b.espacio, "Espacio", 120),
    zona: texto(b.zona, "Zona", 120),
    referenciaFisica: texto(b.referenciaFisica, "Referencia física", 500),
    modelId,
    versionId,
    piso3d: p as Vec3,
    alturaM: b.alturaM === undefined ? undefined : numero(b.alturaM, "Altura del trípode", 0.5, 2.5),
    rumboGrados: rumbo(b.rumboGrados),
  };
}

export function validarCambiosPunto(body: unknown): CambiosPunto {
  const b = objeto(body);
  const c: CambiosPunto = { version: version(b.version) };
  if (b.espacio !== undefined) c.espacio = texto(b.espacio, "Espacio", 120);
  if (b.zona !== undefined) c.zona = texto(b.zona, "Zona", 120);
  if (b.referenciaFisica !== undefined) c.referenciaFisica = texto(b.referenciaFisica, "Referencia física", 500);
  if (b.alturaM !== undefined) c.alturaM = numero(b.alturaM, "Altura del trípode", 0.5, 2.5);
  if (b.rumboGrados !== undefined) c.rumboGrados = rumbo(b.rumboGrados);
  if (b.estado !== undefined) {
    if (b.estado !== "activo" && b.estado !== "inactivo") throw malo("Estado no válido.");
    c.estado = b.estado;
    c.motivo = texto(b.motivo, "Motivo", 1000);
    if (c.estado === "inactivo" && !c.motivo) throw malo("Para desactivar un punto escriba el motivo.");
  }
  return c;
}

export function validarNuevaSubida(body: unknown, ahora: Date): NuevaSubida {
  const b = objeto(body);
  const puntoId = validarId(texto(b.puntoId, "Punto", 64));
  const tomadaEn = texto(b.tomadaEn, "Fecha de la foto", 40);
  const t = Date.parse(tomadaEn);
  if (!/[+-]\d{2}:\d{2}$|Z$/.test(tomadaEn) || Number.isNaN(t)) throw malo("La fecha y hora de la foto no son válidas.");
  if (t > ahora.getTime() + 24 * 3600 * 1000 || t < Date.parse("2000-01-01T00:00:00Z")) throw malo("La fecha de la foto está fuera de rango (¿la hora de la cámara está bien?).");
  const tamano = b.tamano;
  if (!Number.isInteger(tamano) || (tamano as number) <= 0) throw malo("El tamaño de la foto no es válido.");
  if ((tamano as number) > MAX_BYTES_FOTO) throw malo("La foto pesa más de 60 MB.");
  const entero = (v: unknown, campo: string) => {
    if (v === undefined || v === null) return null;
    if (!Number.isInteger(v) || (v as number) <= 0 || (v as number) > 100000) throw malo(`${campo} no válido.`);
    return v as number;
  };
  const miniatura = typeof b.miniatura === "string" ? b.miniatura : "";
  if (miniatura && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(miniatura) || miniatura.length > MAX_MINIATURA)) throw malo("La miniatura de la foto no es válida.");
  return {
    puntoId,
    tomadaEn,
    observaciones: texto(b.observaciones, "Observaciones", 4000),
    nombreOriginal: texto(b.nombreOriginal, "Nombre del archivo", 255),
    tamano: tamano as number,
    ancho: entero(b.ancho, "Ancho"),
    alto: entero(b.alto, "Alto"),
    miniatura,
  };
}

export function validarMotivo(body: unknown): string {
  const motivo = texto(objeto(body).motivo, "Motivo", 1000);
  if (!motivo) throw malo("Escriba el motivo.");
  return motivo;
}
