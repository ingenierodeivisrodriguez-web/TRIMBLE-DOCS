import { Caller, ServiceError } from "../propiedades/service";
import { StoreError } from "../propiedades/store";
import { DIAS_QR_MAX, esCodigo, estadoQr, fechaMasDias, finDelDia, generarCodigo, urlQr } from "./codigo";
import type { RaStore } from "./store";
import {
  ConfigRA,
  DIAS_SIN_USO_INICIAL,
  EstadoResponse,
  HORAS_SUBIDA_INCOMPLETA,
  ModeloGuardado,
  ModeloVista,
  PublicoResponse,
  PuntoGuardado,
  PuntoVista,
  SubidaResponse,
} from "./types";
import { validarDias, validarId, validarNuevoModelo, validarNuevoPunto } from "./validate";

/**
 * Rules of the AR extension (phase 1: models prepared for the phone).
 * - Any member of the project prepares models; only the one who prepared a
 *   model or an administrator removes its file; only administrators change
 *   how many days an unused file is kept.
 * - The file is removed by itself once `diasSinUso` pass without use (owner's
 *   decision); the row stays as "eliminado" so there is a record of it.
 * - QR points (phase 2): any member creates them on a ready model; only who
 *   created one or an administrator cancels it. They are never deleted. The QR
 *   opens without login (owner's decision) until it expires or is cancelled.
 */

export interface Ctx {
  projectId: string;
  caller: Caller;
  store: RaStore;
  /** Injected in tests. */
  ahora?: () => Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;
/** Time the browser has to finish an upload with a signed URL. */
export const SEGUNDOS_SUBIDA = 2 * 60 * 60;

const ahoraDe = (ctx: { ahora?: () => Date }) => (ctx.ahora ? ctx.ahora() : new Date());
const masDias = (desde: Date, dias: number) => new Date(desde.getTime() + dias * DIA_MS).toISOString();

export function traducir(err: unknown): unknown {
  if (err instanceof StoreError && err.status === 404) return new ServiceError("Ese modelo no existe en este proyecto.", 404, "no-existe");
  return err;
}

async function config(ctx: Ctx): Promise<ConfigRA> {
  return (await ctx.store.getConfig(ctx.projectId)) ?? { diasSinUso: DIAS_SIN_USO_INICIAL, actualizado: null, actualizadoPor: null };
}

function vista(ctx: Ctx, m: ModeloGuardado): ModeloVista {
  const { ruta: _r, creadoPorId, ...resto } = m;
  return { ...resto, puedeEliminar: m.estado !== "eliminado" && (ctx.caller.isAdmin || creadoPorId === ctx.caller.id) };
}

async function modelo(ctx: Ctx, id: string): Promise<ModeloGuardado> {
  const m = await ctx.store.obtener(ctx.projectId, validarId(id));
  if (!m) throw new ServiceError("Ese modelo no existe en este proyecto.", 404, "no-existe");
  return m;
}

/**
 * Removes the files of models past their date (any project): unused ones and
 * uploads that never finished. A file that cannot be removed now stays for the
 * next round. Returns how many were removed.
 */
export async function limpiar(store: RaStore, ahora: Date, limite = 50): Promise<number> {
  const vencidos = await store.vencidos(ahora.toISOString(), limite);
  let hechos = 0;
  for (const m of vencidos) {
    try {
      await store.archivos.borrar([m.ruta]);
      await store.actualizar(m.projectId, m.id, {
        estado: "eliminado",
        eliminado: ahora.toISOString(),
        eliminadoPor: null,
        motivoEliminacion: m.estado === "subiendo" ? "subida-incompleta" : "vencido",
      });
      hechos++;
    } catch (err) {
      console.error(`[ra] no se pudo eliminar el modelo vencido ${m.id}:`, err);
    }
  }
  return hechos;
}

export async function estado(ctx: Ctx): Promise<EstadoResponse> {
  // Cleaning is best-effort: it must never keep the screen from opening.
  await limpiar(ctx.store, ahoraDe(ctx)).catch((err) => console.error("[ra] limpieza:", err));
  const [cfg, modelos, puntos] = await Promise.all([config(ctx), ctx.store.listar(ctx.projectId), ctx.store.listarPuntos(ctx.projectId)]);
  const porId = new Map(modelos.map((m) => [m.id, m]));
  return {
    config: cfg,
    modelos: modelos.map((m) => vista(ctx, m)),
    puntos: puntos.map((p) => vistaPunto(ctx, p, porId.get(p.modeloId) ?? null)),
    esAdmin: ctx.caller.isAdmin,
    almacenamiento: ctx.store.archivos.disponible,
  };
}

export async function guardarConfig(ctx: Ctx, body: unknown): Promise<ConfigRA> {
  if (!ctx.caller.isAdmin) throw new ServiceError("Solo un administrador del proyecto cambia cuántos días se guardan los modelos.", 403, "solo-admin");
  const dias = validarDias(body);
  const cfg = await ctx.store.saveConfig(ctx.projectId, dias, ctx.caller.name);
  // The new term applies to the models already prepared, counted from their last use.
  for (const m of await ctx.store.listar(ctx.projectId)) {
    if (m.estado !== "listo") continue;
    const desde = new Date(m.ultimoUso ?? m.creado);
    await ctx.store.actualizar(ctx.projectId, m.id, { eliminaEn: masDias(desde, dias) });
  }
  return cfg;
}

/** Registers a model and hands the browser where to upload its file. */
export async function iniciarSubida(ctx: Ctx, body: unknown): Promise<SubidaResponse> {
  if (!ctx.store.archivos.disponible) throw new ServiceError("El almacenamiento de archivos (Supabase Storage) no está conectado.", 503, "sin-almacenamiento");
  const datos = validarNuevoModelo(body);
  const ahora = ahoraDe(ctx);
  const id = globalThis.crypto.randomUUID();
  const ruta = `${ctx.projectId}/${id}.raq`;
  const m = await ctx.store.crear({
    id,
    projectId: ctx.projectId,
    ...datos,
    estado: "subiendo",
    ruta,
    creado: ahora.toISOString(),
    creadoPor: ctx.caller.name,
    creadoPorId: ctx.caller.id,
    ultimoUso: null,
    eliminaEn: new Date(ahora.getTime() + HORAS_SUBIDA_INCOMPLETA * 60 * 60 * 1000).toISOString(),
    eliminado: null,
    eliminadoPor: null,
    motivoEliminacion: null,
  });
  return { modelo: vista(ctx, m), urlSubida: await ctx.store.archivos.firmarSubida(ruta) };
}

/** After the upload: checks the file arrived whole and starts the unused-days count. */
export async function confirmarSubida(ctx: Ctx, id: string): Promise<ModeloVista> {
  const m = await modelo(ctx, id);
  if (m.creadoPorId !== ctx.caller.id && !ctx.caller.isAdmin) throw new ServiceError("Solo quien preparó el modelo puede confirmar su subida.", 403, "ajeno");
  if (m.estado === "listo") return vista(ctx, m);
  if (m.estado !== "subiendo") throw new ServiceError("Ese modelo ya fue eliminado; prepárelo de nuevo.", 409, "eliminado");
  const tamano = await ctx.store.archivos.tamano(m.ruta);
  if (tamano === null) throw new ServiceError("El archivo del modelo no llegó al almacenamiento. Vuelva a prepararlo.", 409, "sin-archivo");
  if (tamano !== m.bytes) {
    throw new ServiceError(`El archivo llegó incompleto (${tamano} de ${m.bytes} bytes). Vuelva a prepararlo.`, 409, "incompleto");
  }
  const ahora = ahoraDe(ctx);
  const { diasSinUso } = await config(ctx);
  return vista(ctx, await ctx.store.actualizar(ctx.projectId, m.id, { estado: "listo", ultimoUso: ahora.toISOString(), eliminaEn: masDias(ahora, diasSinUso) }));
}

/** Removes a model's file now; the row stays as a record. */
export async function eliminar(ctx: Ctx, id: string): Promise<ModeloVista> {
  const m = await modelo(ctx, id);
  if (m.estado === "eliminado") return vista(ctx, m);
  if (m.creadoPorId !== ctx.caller.id && !ctx.caller.isAdmin) {
    throw new ServiceError("Solo quien preparó el modelo o un administrador del proyecto puede eliminarlo.", 403, "ajeno");
  }
  await ctx.store.archivos.borrar([m.ruta]);
  return vista(
    ctx,
    await ctx.store.actualizar(ctx.projectId, m.id, { estado: "eliminado", eliminado: ahoraDe(ctx).toISOString(), eliminadoPor: ctx.caller.name, motivoEliminacion: "manual" })
  );
}

// ------------------------------------------------------------------ QR points

function vistaPunto(ctx: Ctx, p: PuntoGuardado, m: ModeloGuardado | null): PuntoVista {
  const { creadoPorId, ...resto } = p;
  return {
    ...resto,
    estado: estadoQr(p, m, ahoraDe(ctx)),
    url: urlQr(p.codigo),
    modeloNombre: m?.nombre ?? "",
    puedeAnular: !p.anulado && (ctx.caller.isAdmin || creadoPorId === ctx.caller.id),
  };
}

/** Today's date in Colombia, "AAAA-MM-DD". */
const hoyColombia = (ahora: Date) => fechaMasDias(ahora, 0);

/** A short-lived link to a ready model's file, for the viewer panel (to place the QR on it). */
export async function archivoModelo(ctx: Ctx, id: string): Promise<{ url: string }> {
  const m = await modelo(ctx, id);
  if (m.estado !== "listo") throw new ServiceError("Ese modelo ya no tiene archivo; prepárelo de nuevo.", 409, "eliminado");
  return { url: await ctx.store.archivos.firmar(m.ruta, 600) };
}

export async function crearPunto(ctx: Ctx, body: unknown): Promise<PuntoVista> {
  const ahora = ahoraDe(ctx);
  const datos = validarNuevoPunto(body, hoyColombia(ahora), DIAS_QR_MAX);
  const m = await modelo(ctx, datos.modeloId);
  if (m.estado !== "listo") throw new ServiceError("Ese modelo ya no tiene archivo; prepárelo de nuevo antes de crear el QR.", 409, "eliminado");
  const p = await ctx.store.crearPunto({
    id: globalThis.crypto.randomUUID(),
    projectId: ctx.projectId,
    modeloId: m.id,
    codigo: generarCodigo(),
    nombre: datos.nombre,
    referencia: datos.referencia,
    montaje: datos.montaje,
    punto: datos.punto,
    rumbo: datos.rumbo,
    elemento: datos.elemento,
    vence: finDelDia(datos.vence),
    creado: ahora.toISOString(),
    creadoPor: ctx.caller.name,
    creadoPorId: ctx.caller.id,
    anulado: null,
    anuladoPor: null,
    usos: 0,
    ultimoUso: null,
  });
  return vistaPunto(ctx, p, m);
}

/** Cancels a QR for good: it stops opening (the record stays). */
export async function anularPunto(ctx: Ctx, id: string): Promise<PuntoVista> {
  const p = await ctx.store.obtenerPunto(ctx.projectId, validarId(id));
  if (!p) throw new ServiceError("Ese QR no existe en este proyecto.", 404, "no-existe");
  const m = await ctx.store.obtener(ctx.projectId, p.modeloId);
  if (p.anulado) return vistaPunto(ctx, p, m);
  if (p.creadoPorId !== ctx.caller.id && !ctx.caller.isAdmin) throw new ServiceError("Solo quien creó el QR o un administrador del proyecto puede anularlo.", 403, "ajeno");
  return vistaPunto(ctx, await ctx.store.actualizarPunto(ctx.projectId, p.id, { anulado: ahoraDe(ctx).toISOString(), anuladoPor: ctx.caller.name }), m);
}

/**
 * What the phone learns from a scanned code, without login. Counts the scan
 * when the QR is active. Nothing about the project beyond the QR's own name.
 */
export async function publico(store: RaStore, codigo: string, ahora: Date = new Date()): Promise<PublicoResponse> {
  if (!esCodigo(codigo)) return { estado: "no-existe" };
  const p = await store.puntoPorCodigo(codigo);
  if (!p) return { estado: "no-existe" };
  const m = await store.obtener(p.projectId, p.modeloId);
  const estado = estadoQr(p, m, ahora);
  if (estado !== "activo" || !m) return { estado, nombre: p.nombre };
  await store.actualizarPunto(p.projectId, p.id, { usos: p.usos + 1, ultimoUso: ahora.toISOString() });
  return { estado, nombre: p.nombre, referencia: p.referencia, vence: p.vence, modelo: { nombre: m.nombre, elementos: m.elementos, triangulos: m.triangulos, bytes: m.bytes } };
}
