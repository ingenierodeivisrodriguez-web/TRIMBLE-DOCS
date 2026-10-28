/**
 * Copying files of this project to a folder of another project, with the
 * user's session: only the latest version, straight into the chosen folder,
 * under the same name. One step per request (the browser runs them file by
 * file): compare with what the destination has, copy, follow the upload and
 * ask how the destination's viewer conversion is going. Nothing is stored in
 * Supabase and nothing is deleted.
 *
 * To spare the destination a new conversion of 3D models, a copy tries, in
 * this order: Trimble's own copy of the version (POST /files with
 * fromFileVersionId: nothing goes through this server), then an upload that
 * carries the origin's already converted model (format TRB) with the file,
 * then the file alone.
 */
import { buscarEnCarpeta, ClienteTrimble, estadoSubida, explicarEstado, leerCarpeta, Respuesta, urlDescarga } from "../compras/cde";
import { fechaHora } from "../compras/formato";
import { formatBytes } from "../format";
import { copiarContenido, duracion, velocidad } from "./copia";
import { esIdTrimble, PublicarError } from "./errores";
import { CopiaResponse, PASOS_COPIA, PasoCopia, Situacion } from "./types";

type Fetch = typeof fetch;

/** One project through the user's token: its Core API host and a client for it. */
export interface Lado {
  projectId: string;
  /** Base URL of the project's region. */
  servidor: string;
  cliente: ClienteTrimble;
}

export interface DepsCopia {
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
  modificadoPor: string;
  modificado: string | null;
  /** The folder it is in. */
  padreId: string | null;
}

export function archivoDe(cuerpo: unknown): ArchivoTrimble | null {
  const o = (cuerpo ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const quien = (o.modifiedBy ?? {}) as Record<string, unknown>;
  return {
    id: o.id,
    nombre: texto(o.name) ?? "",
    versionId: texto(o.versionId),
    revision: numero(o.revision),
    tamano: numero(o.size),
    huella: texto(o.md5) ?? texto(o.hash),
    modificadoPor: [texto(quien.firstName), texto(quien.lastName)].filter(Boolean).join(" ") || (texto(quien.email) ?? ""),
    modificado: texto(o.modifiedOn),
    padreId: texto(o.parentId),
  };
}

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;

export async function leerArchivo(c: ClienteTrimble, fileId: string): Promise<{ archivo: ArchivoTrimble | null; respuesta: Respuesta }> {
  const respuesta = await c.pedir("GET", `/files/${encodeURIComponent(fileId)}`);
  return { archivo: ok(respuesta) ? archivoDe(respuesta.cuerpo) : null, respuesta };
}

/** What the destination folder has under the origin file's name. */
export function situacionDe(origen: ArchivoTrimble, destino: ArchivoTrimble | null): Situacion {
  if (!destino) return "nuevo";
  return origen.huella && destino.huella && origen.huella.toLowerCase() === destino.huella.toLowerCase() ? "al-dia" : "distinto";
}

interface Subida {
  respuesta: Respuesta;
  uploadId: string | null;
  /** Signed URL for the file itself. */
  url: string | null;
  /** Signed URL for the converted model, when the upload carries one. */
  urlModelo: string | null;
}

/**
 * Starts an upload of `nombre` into a folder, carrying a converted model
 * (TRB) when asked. `soloNuevo`: refused if the name is there; `siVersion`:
 * a new version only if that one is still the latest.
 */
async function abrirSubida(c: ClienteTrimble, carpetaId: string, nombre: string, o: { conModelo: boolean; soloNuevo?: boolean; siVersion?: string }): Promise<Subida> {
  const encabezados: Record<string, string> = {};
  if (o.soloNuevo) encabezados["If-None-Match"] = "*";
  if (o.siVersion) encabezados["If-Match"] = o.siVersion;
  // The source file is the content without a format.
  const cuerpo = o.conModelo ? { name: nombre, contents: [{}, { format: "TRB" }] } : { name: nombre };
  const respuesta = await c.pedir("POST", `/files/fs/upload?parentId=${encodeURIComponent(carpetaId)}&parentType=FOLDER`, { cuerpo, encabezados });
  const r = (respuesta.cuerpo ?? {}) as { uploadId?: unknown; contents?: { url?: unknown; format?: unknown }[] };
  const contenidos = Array.isArray(r.contents) ? r.contents : [];
  const url = (x: { url?: unknown } | undefined) => (typeof x?.url === "string" ? x.url : null);
  return {
    respuesta,
    uploadId: ok(respuesta) && typeof r.uploadId === "string" ? r.uploadId : null,
    url: url(contenidos.find((x) => !x.format) ?? contenidos[0]),
    urlModelo: url(contenidos.find((x) => x.format === "TRB")),
  };
}

/** The viewer conversion state as Trimble words it, and in plain words. */
export function leerEstadoVisor(cuerpo: unknown): { texto: string; listo: boolean | null } {
  const valores: string[] = [];
  const juntar = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (typeof o.status === "string") valores.push(typeof o.format === "string" ? `${o.format}: ${o.status}` : o.status);
  };
  if (Array.isArray(cuerpo)) cuerpo.forEach(juntar);
  else juntar(cuerpo);
  if (!valores.length) return { texto: cuerpo === null || cuerpo === undefined || cuerpo === "" ? "sin dato" : JSON.stringify(cuerpo).slice(0, 160), listo: null };
  const todo = valores.join(" · ").toUpperCase();
  let listo: boolean | null = null;
  if (/FAIL|ERROR/.test(todo)) listo = false;
  else if (/PROCESSED|COMPLETE|DONE|SUCCESS|READY|AVAILABLE/.test(todo) && !/PROCESSING|PROGRESS|QUEUE|PENDING|WAIT/.test(todo)) listo = true;
  return { texto: valores.join(" · "), listo };
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Runs one step of copying one file. */
export async function pasoCopia(deps: DepsCopia, body: unknown): Promise<CopiaResponse> {
  const o = (body ?? {}) as Record<string, unknown>;
  const paso = o.paso as PasoCopia;
  if (!PASOS_COPIA.includes(paso)) throw new PublicarError("Paso no válido.");
  const id = (k: string) => {
    const v = o[k];
    if (!esIdTrimble(v)) throw new PublicarError(`Falta ${k} o no es válido.`);
    return v;
  };
  const opcional = (k: string) => (o[k] === undefined || o[k] === "" ? null : id(k));
  const responder = (bien: boolean, mensaje: string, datos: Record<string, unknown> = {}): CopiaResponse => ({ paso, ok: bien, mensaje, datos });
  const { origen } = deps;
  const fetchFn = deps.fetch ?? fetch;

  const destinoId = id("destino");
  if (destinoId === origen.projectId) return responder(false, "Elige otro proyecto: la copia es entre proyectos distintos.");
  let d: Lado;
  try {
    d = await deps.destino(destinoId);
  } catch (err) {
    return responder(false, `No se pudo abrir el proyecto destino: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (paso === "estado-subida") {
    const s = await estadoSubida(d.cliente, id("uploadId"));
    const listo = s.status === "DONE";
    const fallo = s.status === "ERROR" || s.status === "EXPIRED" || !ok(s.respuesta);
    const mensaje = listo
      ? `Trimble confirmó la carga: versión ${s.revision ?? "?"} en el destino.`
      : s.status === "ERROR"
        ? `Trimble marcó error en el destino: ${s.errorReason ?? "sin detalle"}.`
        : `Estado en el destino: ${s.status ?? explicarEstado(s.respuesta.estado)}.`;
    return responder(!fallo, mensaje, { status: s.status, fileId: s.fileId, versionId: s.versionId, revision: s.revision, http: s.respuesta.estado });
  }

  if (paso === "estado-visor") {
    const r = await d.cliente.pedir("GET", `/files/${encodeURIComponent(id("fileId"))}/status`);
    if (!ok(r)) return responder(false, `Trimble no dio el estado de la conversión: ${explicarEstado(r.estado)}`, { http: r.estado });
    const e = leerEstadoVisor(r.cuerpo);
    const palabras = e.listo === true ? "listo para ver" : e.listo === false ? "la conversión falló" : "en conversión o sin dato";
    return responder(true, `Visor del destino: ${palabras} (Trimble: ${e.texto}).`, { estado: e.texto, listo: e.listo });
  }

  // revisar / copiar: the origin file is read again each time (its name never comes from the browser).
  const leido = await leerArchivo(origen.cliente, id("fileId"));
  const a = leido.archivo;
  if (!a) return responder(false, `No se pudo leer el archivo en este proyecto: ${explicarEstado(leido.respuesta.estado)}`, { http: leido.respuesta.estado });
  const carpetaId = id("carpetaId");
  const enDestino = await buscarEnCarpeta(d.cliente, carpetaId, a.nombre, "FILE");

  if (paso === "revisar") {
    const { carpeta, respuesta } = await leerCarpeta(d.cliente, carpetaId);
    if (!carpeta) return responder(false, `No se pudo leer la carpeta del destino: ${explicarEstado(respuesta.estado)}`, { http: respuesta.estado });
    if (carpeta.permiso === "READ") return responder(false, `Solo tienes lectura en “${carpeta.nombre}” del proyecto destino: elige una carpeta donde puedas subir archivos.`);
    const b = enDestino ? (await leerArchivo(d.cliente, enDestino.id)).archivo : null;
    const situacion = situacionDe(a, b);
    const datos = {
      situacion,
      origen: { nombre: a.nombre, revision: a.revision, tamano: a.tamano },
      destino: b ? { fileId: b.id, versionId: b.versionId, revision: b.revision, modificadoPor: b.modificadoPor, modificado: b.modificado } : null,
      mismaRegion: d.servidor === origen.servidor,
    };
    if (situacion === "nuevo") return responder(true, `No está en “${carpeta.nombre}”: se copia como archivo nuevo (versión ${a.revision ?? "?"} de este proyecto).`, datos);
    if (situacion === "al-dia") return responder(true, `Ya está al día: la versión ${b?.revision ?? "?"} del destino es igual a la versión ${a.revision ?? "?"} de este proyecto.`, datos);
    const quien = [b?.modificadoPor, b?.modificado ? fechaHora(b.modificado) : ""].filter(Boolean).join(", ");
    return responder(true, `En el destino ya hay un archivo con ese nombre y otro contenido (versión ${b?.revision ?? "?"}${quien ? `, ${quien}` : ""}). No se reemplaza sin tu confirmación.`, datos);
  }

  // copiar: a file already in the destination is only replaced when the
  // person confirmed it, and only if it hasn't changed since they looked.
  const siVersion = opcional("siVersion");
  if (enDestino && !siVersion) return responder(false, "Ya hay un archivo con ese nombre en la carpeta del destino: revísalo antes de reemplazarlo.");
  if (enDestino && siVersion !== enDestino.versionId) return responder(false, "El archivo cambió en el destino después de revisarlo: revísalo otra vez.", { cambio: true });
  if (!a.versionId) return responder(false, "Trimble no dio la versión del archivo en este proyecto.");
  const r = await copiarUltimaVersion({ origen, destino: d, archivo: a, carpetaId, enDestino, sinModelo: o.sinModelo === "1", fetch: fetchFn, reloj: deps.reloj });
  const { ok: bien, mensaje, ...datos } = r;
  return responder(bien, mensaje, datos);
}

export interface ResultadoCopia {
  ok: boolean;
  mensaje: string;
  /** "trimble": Trimble's own copy (done); "servidor": an upload to follow with `uploadId`. */
  metodo?: "trimble" | "servidor";
  listo?: boolean;
  fileId?: string | null;
  versionId?: string | null;
  revision?: number | null;
  uploadId?: string;
  envio?: "flujo" | "memoria" | null;
  modelo?: "copiado" | "sin-modelo" | "rechazado" | "omitido";
  bytes?: number | null;
  ms?: number;
  velocidad?: string | null;
  servidorDestino?: string;
  http?: number;
  /** The file went but not its converted model: copy again without it. */
  reintentarSinModelo?: boolean;
}

/**
 * Copies the latest version of `archivo` into a destination folder, under the
 * same name: a new file, or a new version of `enDestino` (refused by Trimble
 * if that is no longer the latest one, on an upload). Tries Trimble's own
 * copy, then an upload with the converted model, then the file alone.
 */
export async function copiarUltimaVersion(o: {
  origen: Lado;
  destino: Lado;
  archivo: ArchivoTrimble;
  carpetaId: string;
  enDestino: { versionId: string | null } | null;
  sinModelo?: boolean;
  fetch?: Fetch;
  reloj?: () => number;
}): Promise<ResultadoCopia> {
  const { origen, destino: d, archivo: a, carpetaId, enDestino } = o;
  const fetchFn = o.fetch ?? fetch;
  if (!a.versionId) return { ok: false, mensaje: "Trimble no dio la versión del archivo en el origen." };

  const copia = await d.cliente.pedir("POST", "/files", { cuerpo: { parentId: carpetaId, parentType: "FOLDER", fromFileVersionId: a.versionId, mergeExisting: !!enDestino } });
  if (ok(copia)) {
    let b = archivoDe(copia.cuerpo);
    if (!b) {
      const hallado = await buscarEnCarpeta(d.cliente, carpetaId, a.nombre, "FILE");
      b = hallado ? (await leerArchivo(d.cliente, hallado.id)).archivo : null;
    }
    const otroNombre = b && b.nombre && b.nombre !== a.nombre ? ` Trimble lo guardó como “${b.nombre}”.` : "";
    return {
      ok: true,
      mensaje: `Copiado dentro de Trimble, sin pasar por el servidor: versión ${b?.revision ?? "?"} en el destino.${otroNombre}`,
      metodo: "trimble",
      listo: true,
      fileId: b?.id ?? null,
      versionId: b?.versionId ?? null,
      revision: b?.revision ?? null,
    };
  }
  const sinCopiaTrimble = `La copia dentro de Trimble no se pudo (${explicarEstado(copia.estado)}).`;

  // The origin's converted model, unless a previous try with it failed.
  let modelo: "copiado" | "sin-modelo" | "rechazado" | "omitido" = "omitido";
  let urlModeloOrigen: string | null = null;
  if (!o.sinModelo) {
    const r = await origen.cliente.pedir("GET", `/files/fs/${encodeURIComponent(a.id)}/downloadurl?format=TRB`);
    urlModeloOrigen = ok(r) && typeof (r.cuerpo as { url?: unknown } | null)?.url === "string" ? (r.cuerpo as { url: string }).url : null;
    if (!urlModeloOrigen) modelo = "sin-modelo";
  }
  const condicion = enDestino ? { siVersion: enDestino.versionId ?? undefined } : { soloNuevo: true };
  let s = await abrirSubida(d.cliente, carpetaId, a.nombre, { conModelo: !!urlModeloOrigen, ...condicion });
  if (!s.uploadId && urlModeloOrigen && s.respuesta.estado !== 412) {
    modelo = "rechazado";
    urlModeloOrigen = null;
    s = await abrirSubida(d.cliente, carpetaId, a.nombre, { conModelo: false, ...condicion });
  }
  if (!s.uploadId || !s.url) return { ok: false, mensaje: `Trimble no abrió la subida en el destino: ${explicarEstado(s.respuesta.estado)}`, http: s.respuesta.estado };
  const bajada = await urlDescarga(origen.cliente, a.id);
  if (!bajada.url) return { ok: false, mensaje: `Trimble no dio el enlace del archivo en el origen: ${explicarEstado(bajada.respuesta.estado)}`, http: bajada.respuesta.estado };

  const envio = await copiarContenido(bajada.url, s.url, fetchFn, o.reloj);
  if (!envio.ok) return { ok: false, mensaje: envio.mensaje, http: envio.http };
  if (urlModeloOrigen && s.urlModelo) {
    const m = await copiarContenido(urlModeloOrigen, s.urlModelo, fetchFn, o.reloj);
    // Without its model the open upload would never finish: start over without it.
    if (!m.ok) return { ok: false, mensaje: `El archivo llegó, pero no el modelo convertido (${m.mensaje}); se copia otra vez sin él.`, reintentarSinModelo: true };
    modelo = "copiado";
  } else if (urlModeloOrigen) {
    modelo = "rechazado";
  }

  const v = velocidad(envio.bytes, envio.ms);
  const sobreModelo = {
    copiado: " Con el modelo ya convertido del origen.",
    "sin-modelo": " El origen no tiene modelo convertido de ese archivo: Trimble lo convertirá en el destino.",
    rechazado: " Trimble no aceptó el modelo convertido junto con el archivo: lo convertirá en el destino.",
    omitido: " Sin el modelo convertido (el intento con él falló): Trimble lo convertirá en el destino.",
  }[modelo];
  return {
    ok: true,
    mensaje: `Copiado por el servidor: ${formatBytes(envio.bytes ?? 0)} en ${duracion(envio.ms)}${v ? ` (${v})` : ""}.${sobreModelo} ${sinCopiaTrimble}`,
    metodo: "servidor",
    listo: false,
    uploadId: s.uploadId,
    envio: envio.metodo,
    modelo,
    bytes: envio.bytes,
    ms: envio.ms,
    velocidad: v,
    servidorDestino: host(d.servidor),
  };
}
