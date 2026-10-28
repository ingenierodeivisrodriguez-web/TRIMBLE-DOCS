/**
 * Phase 0 of "Publicar entre proyectos": the test that checks, with a real
 * file and the user's session, that a version can be copied from this
 * project to another one. Each step is one request (the browser runs them in
 * order): read the origin file, prepare a test folder in the chosen
 * destination folder, copy through the server (new file, then a new version
 * with the same name), check that Trimble refuses an upload over a version
 * that is no longer the latest, try the copy from the browser, and compare
 * what arrived. Nothing is stored in Supabase and nothing is deleted.
 */
import { buscarEnCarpeta, ClienteTrimble, crearCarpeta, estadoSubida, explicarEstado, iniciarSubida, leerCarpeta, Respuesta, urlDescarga } from "../compras/cde";
import { formatBytes } from "../format";
import { copiarContenido, duracion, LIMITE_MEMORIA, maximoEstimado, velocidad } from "./copia";
import { esIdTrimble, PublicarError } from "./errores";
import { CARPETA_PRUEBA, PASOS_PRUEBA, PasoPrueba, PruebaResponse } from "./types";

export { CARPETA_PRUEBA };

type Fetch = typeof fetch;

/** One project through the user's token: its Core API host and a client for it. */
export interface Lado {
  projectId: string;
  /** Base URL of the project's region. */
  servidor: string;
  cliente: ClienteTrimble;
}

export interface DepsPrueba {
  origen: Lado;
  /** The destination project; throws when the user can't see it. */
  destino(projectId: string): Promise<Lado>;
  fetch?: Fetch;
  reloj?: () => number;
}

export interface ArchivoTrimble {
  id: string;
  nombre: string;
  versionId: string | null;
  revision: number | null;
  tamano: number | null;
  /** MD5 of the content, when Trimble gives it. */
  huella: string | null;
}

function archivoDe(cuerpo: unknown): ArchivoTrimble | null {
  const o = (cuerpo ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: o.id,
    nombre: texto(o.name) ?? "",
    versionId: texto(o.versionId),
    revision: numero(o.revision),
    tamano: numero(o.size),
    huella: texto(o.md5) ?? texto(o.hash),
  };
}

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;

async function leerArchivo(c: ClienteTrimble, fileId: string): Promise<{ archivo: ArchivoTrimble | null; respuesta: Respuesta }> {
  const respuesta = await c.pedir("GET", `/files/${encodeURIComponent(fileId)}`);
  return { archivo: ok(respuesta) ? archivoDe(respuesta.cuerpo) : null, respuesta };
}

/** The file's versions, oldest first (GET /files/{id}/versions answers 206 with the list). */
async function versionesDe(c: ClienteTrimble, fileId: string): Promise<ArchivoTrimble[]> {
  const r = await c.pedir("GET", `/files/${encodeURIComponent(fileId)}/versions`);
  if (!ok(r) || !Array.isArray(r.cuerpo)) return [];
  return r.cuerpo
    .map(archivoDe)
    .filter((v): v is ArchivoTrimble => v !== null)
    .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Runs one step of the test. */
export async function pasoPrueba(deps: DepsPrueba, body: unknown): Promise<PruebaResponse> {
  const o = (body ?? {}) as Record<string, unknown>;
  const paso = o.paso as PasoPrueba;
  if (!PASOS_PRUEBA.includes(paso)) throw new PublicarError("Paso no válido.");
  const id = (k: string) => {
    const v = o[k];
    if (!esIdTrimble(v)) throw new PublicarError(`Falta ${k} o no es válido.`);
    return v;
  };
  const responder = (bien: boolean, mensaje: string, datos: Record<string, unknown> = {}): PruebaResponse => ({ paso, ok: bien, mensaje, datos });
  const { origen } = deps;
  const fetchFn = deps.fetch ?? fetch;

  /** The destination, or why it can't be opened. */
  async function abrirDestino(): Promise<Lado | PruebaResponse> {
    const destino = id("destino");
    if (destino === origen.projectId) return responder(false, "Elige otro proyecto: la prueba copia entre proyectos distintos.");
    try {
      return await deps.destino(destino);
    } catch (err) {
      return responder(false, `No se pudo abrir el proyecto destino: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const esRespuesta = (x: Lado | PruebaResponse): x is PruebaResponse => "paso" in x;

  /** The origin file (read again in every step: the server never takes its name from the browser). */
  async function archivoOrigen(): Promise<ArchivoTrimble | PruebaResponse> {
    const { archivo, respuesta } = await leerArchivo(origen.cliente, id("fileId"));
    return archivo ?? responder(false, `No se pudo leer el archivo en este proyecto: ${explicarEstado(respuesta.estado)}`, { http: respuesta.estado });
  }

  if (paso === "leer-origen") {
    const a = await archivoOrigen();
    if ("paso" in a) return a;
    return responder(
      true,
      `“${a.nombre}”: versión ${a.revision ?? "sin dato"}, ${a.tamano !== null ? formatBytes(a.tamano) : "tamaño sin dato"}, ${a.huella ? "con huella MD5" : "Trimble no da su huella MD5"} (servidor ${host(origen.servidor)}).`,
      { archivo: a, servidor: host(origen.servidor) }
    );
  }

  const d = await abrirDestino();
  if (esRespuesta(d)) return d;

  if (paso === "preparar-destino") {
    const { carpeta, respuesta } = await leerCarpeta(d.cliente, id("carpetaId"));
    if (!carpeta) return responder(false, `No se pudo leer la carpeta del destino: ${explicarEstado(respuesta.estado)}`, { http: respuesta.estado });
    if (carpeta.permiso === "READ") return responder(false, `Solo tienes lectura en “${carpeta.nombre}” del proyecto destino: elige una carpeta donde puedas subir archivos.`);
    const existente = await buscarEnCarpeta(d.cliente, carpeta.id, CARPETA_PRUEBA, "FOLDER");
    let carpetaPruebaId = existente?.id ?? null;
    if (!carpetaPruebaId) {
      const hecha = await crearCarpeta(d.cliente, carpeta, CARPETA_PRUEBA);
      if (!hecha.carpeta) return responder(false, `No se pudo crear la carpeta de prueba en el destino: ${explicarEstado(hecha.respuesta.estado)}`, { http: hecha.respuesta.estado });
      carpetaPruebaId = hecha.carpeta.id;
    }
    const mismaRegion = d.servidor === origen.servidor;
    return responder(
      true,
      `Carpeta de prueba ${existente ? "encontrada (de una prueba anterior)" : "creada"} dentro de “${carpeta.nombre}”. El destino está ${mismaRegion ? "en la misma región de Trimble que este proyecto" : `en otra región de Trimble (${host(d.servidor)}; este proyecto en ${host(origen.servidor)})`}.`,
      { carpetaPruebaId, creada: !existente, mismaRegion }
    );
  }

  if (paso === "estado-subida") {
    const s = await estadoSubida(d.cliente, id("uploadId"));
    const listo = s.status === "DONE";
    const fallo = s.status === "ERROR" || s.status === "EXPIRED" || !ok(s.respuesta);
    const mensaje = listo
      ? `Trimble confirmó la carga en el destino: versión ${s.revision ?? "?"}.`
      : s.status === "ERROR"
        ? `Trimble marcó error en el destino: ${s.errorReason ?? "sin detalle"}.`
        : `Estado en el destino: ${s.status ?? explicarEstado(s.respuesta.estado)}.`;
    return responder(!fallo, mensaje, { status: s.status, fileId: s.fileId, versionId: s.versionId, revision: s.revision, http: s.respuesta.estado });
  }

  const a = await archivoOrigen();
  if ("paso" in a) return a;

  if (paso === "comprobar") {
    const { archivo: b, respuesta } = await leerArchivo(d.cliente, id("destinoFileId"));
    if (!b) return responder(false, `No se pudo leer la copia en el destino: ${explicarEstado(respuesta.estado)}`, { http: respuesta.estado });
    const versiones = await versionesDe(d.cliente, b.id);
    const mismoTamano = a.tamano !== null && b.tamano !== null ? a.tamano === b.tamano : null;
    const mismaHuella = a.huella && b.huella ? a.huella.toLowerCase() === b.huella.toLowerCase() : null;
    const lista = versiones.map((v) => v.revision ?? "?").join(", ");
    return responder(
      mismoTamano !== false && mismaHuella !== false,
      `En el destino “${b.nombre}” está en la versión ${b.revision ?? "?"}${versiones.length ? ` (versiones: ${lista})` : " (Trimble no dio la lista de versiones)"}; en este proyecto, en la ${a.revision ?? "?"}. Tamaño: ${mismoTamano === null ? "sin dato" : mismoTamano ? "igual" : "DISTINTO"}. Huella MD5: ${mismaHuella === null ? "no disponible" : mismaHuella ? "igual" : "DISTINTA"}.`,
      { revisionDestino: b.revision, revisionOrigen: a.revision, versiones: versiones.map((v) => v.revision), mismoTamano, mismaHuella }
    );
  }

  const carpetaPruebaId = id("carpetaPruebaId");

  if (paso === "proteccion") {
    // An upload "If-Match" a version that is no longer the latest must be refused;
    // if Trimble opens it anyway, no content is sent and it expires by itself.
    const s = await iniciarSubida(d.cliente, carpetaPruebaId, a.nombre, { siVersion: id("versionVieja") });
    const protege = !s.uploadId || s.respuesta.estado >= 400;
    return responder(
      protege,
      protege
        ? `Trimble rechazó subir encima de una versión que ya no es la última (${explicarEstado(s.respuesta.estado)}). Así la extensión nunca pisará en silencio un cambio hecho en el destino.`
        : "Trimble abrió la subida aunque esa versión ya no era la última: la extensión tendrá que comparar las versiones antes de subir. (No se envió contenido; esa subida vence sola en 90 minutos.)",
      { protege, http: s.respuesta.estado }
    );
  }

  // copiar / abrir-copia-navegador: an upload with the origin's name (a new
  // version when it's already there, only if that is still the latest one).
  const existente = await buscarEnCarpeta(d.cliente, carpetaPruebaId, a.nombre, "FILE");
  if (paso === "abrir-copia-navegador" && a.tamano !== null && a.tamano > LIMITE_MEMORIA) {
    return responder(false, `El archivo pesa ${formatBytes(a.tamano)}: no se prueba la copia desde el navegador con archivos de más de ${formatBytes(LIMITE_MEMORIA)}.`);
  }
  const s = await iniciarSubida(d.cliente, carpetaPruebaId, a.nombre, existente ? { siVersion: existente.versionId ?? undefined } : { soloNuevo: true });
  if (!s.uploadId || !s.url) return responder(false, `Trimble no abrió la subida en el destino: ${explicarEstado(s.respuesta.estado)}`, { http: s.respuesta.estado });
  const bajada = await urlDescarga(origen.cliente, a.id);
  if (!bajada.url) return responder(false, `Trimble no dio el enlace del archivo en este proyecto: ${explicarEstado(bajada.respuesta.estado)}`, { http: bajada.respuesta.estado });

  if (paso === "abrir-copia-navegador") {
    return responder(true, `Subida abierta en el destino como ${existente ? "versión nueva" : "archivo nuevo"}: ahora tu navegador baja el archivo y lo sube.`, {
      uploadId: s.uploadId,
      bajar: bajada.url,
      subir: s.url,
      nuevaVersion: !!existente,
    });
  }

  const copia = await copiarContenido(bajada.url, s.url, fetchFn, deps.reloj);
  const v = velocidad(copia.bytes, copia.ms);
  return responder(copia.ok, copia.ok ? `${copia.mensaje} ${formatBytes(copia.bytes ?? 0)} en ${duracion(copia.ms)}${v ? ` (${v})` : ""}.` : copia.mensaje, {
    uploadId: s.uploadId,
    nuevaVersion: !!existente,
    bytes: copia.bytes,
    ms: copia.ms,
    metodo: copia.metodo,
    velocidad: v,
    maximo: maximoEstimado(copia.bytes, copia.ms),
    http: copia.http,
  });
}
