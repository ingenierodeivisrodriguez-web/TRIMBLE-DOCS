import { randomUUID } from "node:crypto";
import { buscarEnCarpeta, type Carpeta, type ClienteTrimble, crearCarpeta, estadoSubida, explicarEstado, iniciarSubida as iniciarSubidaCde, leerCarpeta } from "../compras/cde";
import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import { TrimbleApiError } from "../trimbleApi";
import { armarCodigo, nombreArchivo, rutaCarpetas, siguienteNumero } from "./codigos";
import { enBogota } from "./fechas";
import { leerCabeceraJpeg } from "./jpeg";
import { ConflictoVersion, I360Store, Repetido } from "./store";
import {
  ALTURA_INICIAL_M,
  CARPETA_INICIAL,
  Captura,
  CapturaVista,
  ConfigI360,
  EstadoResponse,
  Foto,
  Punto,
  PuntoVista,
  SubidaResponse,
} from "./types";
import { validarAlineacion, validarCambiosPunto, validarConfig, validarId, validarMotivo, validarNuevaSubida, validarNuevoPunto } from "./validate";

/**
 * Rules of Inspección 360° (first stage, owner's decisions of 26-11-2026):
 * - Any member of the project sees the points and their photos.
 * - The project's administrators and the editors they choose create points, upload photos and
 *   cancel captures; only administrators change the configuration.
 * - Nothing is deleted: a point is deactivated and a capture cancelled, always with a reason.
 *   A point's code is never reused.
 * - The photo goes to the CDE (folder Inspección 360 / torre / piso / unidad / punto) with a fixed
 *   name; Supabase only keeps it while it is on its way there.
 */

export interface DepsI360 {
  /** Trimble Core API client with the caller's token, and the project's root folder. */
  cde?: () => Promise<{ cliente: ClienteTrimble; rootId: string }>;
  /** PUT of the photo to Trimble's signed upload URL (no token, no content type). */
  enviar?: (url: string, datos: Uint8Array) => Promise<number>;
  esperar?: (ms: number) => Promise<void>;
}

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: I360Store;
  deps: DepsI360;
  /** Injected in tests. */
  ahora?: () => Date;
}

const ahoraDe = (ctx: Ctx) => (ctx.ahora ? ctx.ahora() : new Date());
const CONFIG_INICIAL: ConfigI360 = { codigoProyecto: null, carpetaNombre: CARPETA_INICIAL, editores: [], version: 0, actualizado: null, actualizadoPor: null };

export function traducir(err: unknown): unknown {
  if (err instanceof ConflictoVersion) return new ServiceError("Otra persona guardó cambios antes que usted. Se recargaron los datos; revise y vuelva a guardar.", 409, "version-conflict");
  if (err instanceof Repetido) return new ServiceError("Ya existe un punto con ese código en el proyecto.", 409, "codigo-repetido");
  if (err instanceof StoreError && err.status === 404) return new ServiceError(err.message, 404, "no-existe");
  return err;
}

async function config(ctx: Ctx): Promise<ConfigI360> {
  return (await ctx.store.getConfig(ctx.projectId)) ?? CONFIG_INICIAL;
}

function puedeEditar(ctx: Ctx, c: ConfigI360): boolean {
  return ctx.caller.isAdmin || c.editores.includes(ctx.caller.id);
}

async function exigirEditor(ctx: Ctx): Promise<ConfigI360> {
  const c = await config(ctx);
  if (!puedeEditar(ctx, c)) throw new ServiceError("Solo los administradores del proyecto y los editores de Inspección 360° pueden hacer esto.", 403, "sin-permiso");
  return c;
}

export async function estado(ctx: Ctx): Promise<EstadoResponse> {
  const c = await config(ctx);
  return {
    config: c,
    esAdmin: ctx.caller.isAdmin,
    puedeEditar: puedeEditar(ctx, c),
    usuario: { id: ctx.caller.id, nombre: ctx.caller.name },
    almacenamiento: ctx.store.archivos.disponible,
  };
}

export async function guardarConfig(ctx: Ctx, body: unknown): Promise<ConfigI360> {
  if (!ctx.caller.isAdmin) throw new ServiceError("Solo los administradores del proyecto cambian la configuración.", 403, "sin-permiso");
  const v = validarConfig(body);
  const actual = await config(ctx);
  // The project code is in every point code: once there are points it cannot change.
  if (actual.codigoProyecto && v.codigoProyecto !== actual.codigoProyecto && (await ctx.store.listarPuntos(ctx.projectId)).length > 0) {
    throw new ServiceError(`El código del proyecto (${actual.codigoProyecto}) ya está en los códigos de los puntos y no se puede cambiar.`, 409, "codigo-en-uso");
  }
  return ctx.store.saveConfig(ctx.projectId, { codigoProyecto: v.codigoProyecto, carpetaNombre: v.carpetaNombre ?? actual.carpetaNombre, editores: v.editores }, v.version, ctx.caller.name || ctx.caller.id);
}

export async function listarPuntos(ctx: Ctx): Promise<PuntoVista[]> {
  const [puntos, capturas] = await Promise.all([ctx.store.listarPuntos(ctx.projectId), ctx.store.listarCapturas(ctx.projectId)]);
  const resumen = new Map<string, { capturas: number; ultima: string | null }>();
  for (const c of capturas) {
    if (c.estado !== "lista") continue;
    const r = resumen.get(c.puntoId) ?? { capturas: 0, ultima: null };
    r.capturas++;
    if (!r.ultima || Date.parse(c.tomadaEn) > Date.parse(r.ultima)) r.ultima = c.tomadaEn;
    resumen.set(c.puntoId, r);
  }
  return puntos.map((p) => ({ ...p, capturas: resumen.get(p.id)?.capturas ?? 0, ultimaCaptura: resumen.get(p.id)?.ultima ?? null }));
}

export async function crearPunto(ctx: Ctx, body: unknown): Promise<PuntoVista> {
  const c = await exigirEditor(ctx);
  if (!c.codigoProyecto) throw new ServiceError("Antes de crear puntos, un administrador debe fijar el código del proyecto (por ejemplo MAL) en la configuración.", 409, "sin-codigo-proyecto");
  const n = validarNuevoPunto(body);
  const existentes = await ctx.store.listarPuntos(ctx.projectId);
  const numero = n.numero ?? siguienteNumero(existentes, n.torre, n.piso, n.unidad);
  const codigo = armarCodigo({ proyecto: c.codigoProyecto, torre: n.torre, piso: n.piso, unidad: n.unidad, numero });
  if (existentes.some((p) => p.codigo === codigo)) throw new ServiceError(`El punto ${codigo} ya existe (los códigos no se reutilizan, aunque el punto esté inactivo).`, 409, "codigo-repetido");
  const altura = n.alturaM ?? ALTURA_INICIAL_M;
  const ahora = ahoraDe(ctx).toISOString();
  const punto: Punto = {
    id: randomUUID(),
    projectId: ctx.projectId,
    codigo,
    torre: n.torre,
    piso: n.piso,
    unidad: n.unidad,
    numero,
    espacio: n.espacio ?? "",
    zona: n.zona ?? "",
    referenciaFisica: n.referenciaFisica ?? "",
    modelId: n.modelId,
    versionId: n.versionId ?? null,
    x: n.piso3d[0],
    y: n.piso3d[1],
    z: n.piso3d[2] + altura,
    alturaM: altura,
    rumboGrados: n.rumboGrados ?? null,
    estado: "activo",
    motivo: "",
    version: 1,
    creado: ahora,
    creadoPor: ctx.caller.id,
    creadoPorNombre: ctx.caller.name,
    actualizado: ahora,
    actualizadoPor: null,
  };
  return { ...(await ctx.store.crearPunto(punto)), capturas: 0, ultimaCaptura: null };
}

export async function editarPunto(ctx: Ctx, id: string, body: unknown): Promise<Punto> {
  await exigirEditor(ctx);
  const actual = await ctx.store.obtenerPunto(ctx.projectId, validarId(id));
  if (!actual) throw new ServiceError("Ese punto no existe en este proyecto.", 404, "no-existe");
  const c = validarCambiosPunto(body);
  const cambios: Partial<Punto> = { actualizadoPor: ctx.caller.name || ctx.caller.id };
  if (c.espacio !== undefined) cambios.espacio = c.espacio;
  if (c.zona !== undefined) cambios.zona = c.zona;
  if (c.referenciaFisica !== undefined) cambios.referenciaFisica = c.referenciaFisica;
  if (c.rumboGrados !== undefined) cambios.rumboGrados = c.rumboGrados;
  if (c.alturaM !== undefined && c.alturaM !== actual.alturaM) {
    // The stored z is floor + tripod height: keep the floor, change the height.
    cambios.alturaM = c.alturaM;
    cambios.z = actual.z - actual.alturaM + c.alturaM;
  }
  if (c.estado) {
    cambios.estado = c.estado;
    cambios.motivo = c.estado === "inactivo" ? c.motivo ?? "" : "";
  }
  return ctx.store.actualizarPunto(ctx.projectId, actual.id, c.version, cambios);
}

function vistaCaptura(ctx: Ctx, c: Captura, f: Foto | undefined, editor: boolean): CapturaVista {
  const foto = f ? (({ rutaTemporal: _r, ...resto }) => resto)(f) : null;
  return { ...c, foto, puedeAnular: editor && c.estado !== "anulada" };
}

export async function listarCapturas(ctx: Ctx, puntoId: string): Promise<CapturaVista[]> {
  const id = validarId(puntoId);
  const [c, capturas] = await Promise.all([config(ctx), ctx.store.listarCapturas(ctx.projectId, id)]);
  const fotos = await ctx.store.fotosDe(ctx.projectId, capturas.map((x) => x.id));
  const porCaptura = new Map(fotos.filter((f) => f.tipo === "360").map((f) => [f.capturaId, f]));
  // Uploads abandoned more than a day ago are hidden (the person closed the window mid-way).
  const limite = ahoraDe(ctx).getTime() - 24 * 3600 * 1000;
  return capturas
    .filter((x) => x.estado !== "subiendo" || Date.parse(x.creado) > limite)
    .map((x) => vistaCaptura(ctx, x, porCaptura.get(x.id), puedeEditar(ctx, c)));
}

export async function iniciarSubida(ctx: Ctx, body: unknown): Promise<SubidaResponse> {
  const c = await exigirEditor(ctx);
  const s = validarNuevaSubida(body, ahoraDe(ctx));
  const punto = await ctx.store.obtenerPunto(ctx.projectId, s.puntoId);
  if (!punto) throw new ServiceError("Ese punto no existe en este proyecto.", 404, "no-existe");
  if (punto.estado !== "activo") throw new ServiceError("El punto está inactivo: actívelo antes de subir fotos.", 409, "punto-inactivo");
  const local = enBogota(s.tomadaEn);
  const base = nombreArchivo(punto.codigo, local).replace(/\.jpg$/, "");
  const usados = new Set(await ctx.store.nombresUsados(ctx.projectId, base));
  let repetido = 1;
  while (usados.has(nombreArchivo(punto.codigo, local, repetido))) repetido++;
  const ahora = ahoraDe(ctx).toISOString();
  const captura: Captura = {
    id: randomUUID(),
    projectId: ctx.projectId,
    puntoId: punto.id,
    tomadaEn: s.tomadaEn,
    observaciones: s.observaciones ?? "",
    estado: "subiendo",
    motivo: "",
    inspectorId: ctx.caller.id,
    inspectorNombre: ctx.caller.name,
    creado: ahora,
    actualizado: ahora,
    actualizadoPor: null,
    giroGrados: 0,
    giroPor: null,
    giroEn: null,
  };
  const fotoId = randomUUID();
  const rutaTemporal = `${ctx.projectId}/${fotoId}.jpg`;
  const foto: Foto = {
    id: fotoId,
    projectId: ctx.projectId,
    capturaId: captura.id,
    tipo: "360",
    nombreArchivo: nombreArchivo(punto.codigo, local, repetido),
    nombreOriginal: s.nombreOriginal,
    tamano: s.tamano,
    ancho: s.ancho ?? null,
    alto: s.alto ?? null,
    miniatura: s.miniatura,
    rutaTemporal,
    cdeCarpetaId: null,
    cdeFileId: null,
    cdeVersionId: null,
    estado: "subiendo",
    error: "",
    creado: ahora,
    actualizado: ahora,
  };
  const url = await ctx.store.archivos.firmarSubida(rutaTemporal);
  const guardada = await ctx.store.crearCaptura(captura);
  const f = await ctx.store.crearFoto(foto);
  return { captura: vistaCaptura(ctx, guardada, f, puedeEditar(ctx, c)), url };
}

/** Finds or creates each folder of the path under the project's root. */
async function carpetaDelPunto(cliente: ClienteTrimble, rootId: string, nombres: string[]): Promise<Carpeta> {
  const raiz = await leerCarpeta(cliente, rootId);
  if (!raiz.carpeta) throw new Error(`no se pudo leer la carpeta raíz del proyecto (${explicarEstado(raiz.respuesta.estado)})`);
  let padre = raiz.carpeta;
  for (const nombre of nombres) {
    const hallada = await buscarEnCarpeta(cliente, padre.id, nombre, "FOLDER");
    if (hallada) {
      padre = { id: hallada.id, versionId: hallada.versionId, nombre, permiso: null };
      continue;
    }
    const creada = await crearCarpeta(cliente, padre, nombre);
    if (!creada.carpeta) throw new Error(`no se pudo crear la carpeta "${nombre}" (${explicarEstado(creada.respuesta.estado)})`);
    padre = creada.carpeta;
  }
  return padre;
}

/**
 * The browser already put the photo in Supabase: copy it to its folder in the CDE, register it
 * and remove the temporary copy. A retry never creates a second file (fixed name; if Trimble
 * already has it, it is only confirmed).
 */
export async function confirmarSubida(ctx: Ctx, fotoId: string): Promise<CapturaVista> {
  const c = await exigirEditor(ctx);
  const foto = await ctx.store.obtenerFoto(ctx.projectId, validarId(fotoId));
  if (!foto) throw new ServiceError("Esa foto no existe en este proyecto.", 404, "no-existe");
  const captura = await ctx.store.obtenerCaptura(ctx.projectId, foto.capturaId);
  if (!captura) throw new ServiceError("La captura de la foto no existe.", 404, "no-existe");
  if (foto.estado === "en_cde") return vistaCaptura(ctx, captura, foto, true);
  if (captura.estado === "anulada") throw new ServiceError("La captura está anulada.", 409, "anulada");
  const punto = await ctx.store.obtenerPunto(ctx.projectId, captura.puntoId);
  if (!punto) throw new ServiceError("El punto de la foto no existe.", 404, "no-existe");
  if (!foto.rutaTemporal) throw new ServiceError("La foto no tiene copia temporal: vuelva a subirla.", 409, "sin-archivo");
  const datos = await ctx.store.archivos.leer(foto.rutaTemporal);
  if (!datos) throw new ServiceError("La foto no llegó al almacenamiento temporal: vuelva a subirla.", 409, "sin-archivo");
  if (datos.length !== foto.tamano) throw new ServiceError(`La foto llegó incompleta (${datos.length} de ${foto.tamano} bytes): vuelva a subirla.`, 409, "incompleta");
  if (!leerCabeceraJpeg(datos.subarray(0, 1 << 20))) throw new ServiceError("El archivo no es una imagen JPG.", 400, "no-es-jpeg");
  if (!ctx.deps.cde || !ctx.deps.enviar) throw new ServiceError("La conexión con Trimble Connect no está disponible.", 503, "sin-trimble");
  const esperar = ctx.deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const { cliente, rootId } = await ctx.deps.cde();
    const carpeta = await carpetaDelPunto(cliente, rootId, rutaCarpetas(c.carpetaNombre, punto));
    let fileId: string;
    let versionId: string;
    const existente = await buscarEnCarpeta(cliente, carpeta.id, foto.nombreArchivo, "FILE");
    if (existente?.versionId) {
      fileId = existente.id;
      versionId = existente.versionId;
    } else {
      const s = await iniciarSubidaCde(cliente, carpeta.id, foto.nombreArchivo, { soloNuevo: true });
      if (!s.uploadId || !s.url) throw new Error(`Trimble no aceptó iniciar la subida (${s.errorReason || explicarEstado(s.respuesta.estado)})`);
      const http = await ctx.deps.enviar(s.url, datos);
      if (http < 200 || http >= 300) throw new Error(`el almacenamiento de Trimble rechazó la foto (HTTP ${http})`);
      let e = await estadoSubida(cliente, s.uploadId);
      for (let i = 0; i < 20 && e.status !== "DONE" && e.status !== "ERROR" && e.status !== "EXPIRED"; i++) {
        await esperar(1500);
        e = await estadoSubida(cliente, s.uploadId);
      }
      if (e.status !== "DONE" || !e.fileId || !e.versionId) throw new Error(`Trimble no terminó de registrar la foto (${e.status ?? "sin estado"}${e.errorReason ? `: ${e.errorReason}` : ""})`);
      fileId = e.fileId;
      versionId = e.versionId;
    }
    const lista = await ctx.store.actualizarFoto(ctx.projectId, foto.id, { estado: "en_cde", cdeCarpetaId: carpeta.id, cdeFileId: fileId, cdeVersionId: versionId, rutaTemporal: null, error: "" });
    const capturaLista = await ctx.store.actualizarCaptura(ctx.projectId, captura.id, { estado: "lista" });
    await ctx.store.archivos.borrar([foto.rutaTemporal]).catch(() => {});
    return vistaCaptura(ctx, capturaLista, lista, true);
  } catch (err) {
    if (err instanceof TrimbleApiError && err.status === 401) throw err;
    const mensaje = err instanceof Error ? err.message : String(err);
    await ctx.store.actualizarFoto(ctx.projectId, foto.id, { estado: "error", error: mensaje.slice(0, 2000) }).catch(() => {});
    await ctx.store.actualizarCaptura(ctx.projectId, captura.id, { estado: "error" }).catch(() => {});
    throw new ServiceError(`La foto quedó guardada temporalmente pero no pasó a Trimble Connect: ${mensaje}. Puede reintentar.`, 502, "cde");
  }
}

export async function anularCaptura(ctx: Ctx, id: string, body: unknown): Promise<CapturaVista> {
  await exigirEditor(ctx);
  const captura = await ctx.store.obtenerCaptura(ctx.projectId, validarId(id));
  if (!captura) throw new ServiceError("Esa captura no existe en este proyecto.", 404, "no-existe");
  const motivo = validarMotivo(body);
  const anulada = await ctx.store.actualizarCaptura(ctx.projectId, captura.id, { estado: "anulada", motivo, actualizadoPor: ctx.caller.name || ctx.caller.id });
  const [foto] = await ctx.store.fotosDe(ctx.projectId, [captura.id]);
  return vistaCaptura(ctx, anulada, foto, true);
}

/**
 * Saves the turn that lines a photo up with the other dates of its point, so everyone sees the
 * photos aligned. Only editors; another person's newer turn is never overwritten silently.
 */
export async function alinearCaptura(ctx: Ctx, id: string, body: unknown): Promise<CapturaVista> {
  await exigirEditor(ctx);
  const { giro, anterior } = validarAlineacion(body);
  const captura = await ctx.store.obtenerCaptura(ctx.projectId, validarId(id));
  if (!captura) throw new ServiceError("Esa captura no existe en este proyecto.", 404, "no-existe");
  if (captura.estado === "anulada") throw new ServiceError("La captura está anulada: no se alinea.", 409, "anulada");
  let guardada = captura;
  if (captura.giroGrados !== giro) {
    try {
      guardada = await ctx.store.alinearCaptura(ctx.projectId, captura.id, anterior, giro, ctx.caller.name || ctx.caller.id);
    } catch (err) {
      if (!(err instanceof ConflictoVersion)) throw err;
      const actual = await ctx.store.obtenerCaptura(ctx.projectId, captura.id);
      const g = actual ? `${actual.giroGrados.toLocaleString("es-CO")}°` : "otro";
      const quien = actual?.giroPor ? ` (${actual.giroPor})` : "";
      throw new ServiceError(`Otra persona${quien} guardó un giro de ${g} para esta foto mientras usted la alineaba. Se cargó ese giro: revíselo y vuelva a guardar si hace falta.`, 409, "giro-conflicto");
    }
  }
  const fotos = await ctx.store.fotosDe(ctx.projectId, [captura.id]);
  return vistaCaptura(ctx, guardada, fotos.find((f) => f.tipo === "360"), true);
}

/** Which CDE file to stream for a photo (any member may see it). */
export async function archivoFoto(ctx: Ctx, fotoId: string): Promise<{ fileId: string; versionId: string; nombre: string }> {
  const foto = await ctx.store.obtenerFoto(ctx.projectId, validarId(fotoId));
  if (!foto) throw new ServiceError("Esa foto no existe en este proyecto.", 404, "no-existe");
  if (foto.estado !== "en_cde" || !foto.cdeFileId || !foto.cdeVersionId) throw new ServiceError("La foto todavía no está en Trimble Connect.", 409, "no-en-cde");
  return { fileId: foto.cdeFileId, versionId: foto.cdeVersionId, nombre: foto.nombreArchivo };
}
