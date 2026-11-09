/**
 * "Flujo de aprobación", phases 4 and B: copying the approved version to a
 * folder, with the session of whoever approved it (right after the approval,
 * or later) or of an administrator (retry). Flows made before 09-11-2026 copy
 * to their destination folder; newer ones to the folder the responsible
 * chooses, which must not be read-only for them in Trimble nor hold a file
 * with that name that goes through a flow. Inside the same project:
 * - nothing with that name in the destination → Trimble's own copy
 *   (POST /files fromFileVersionId: confirmed in the phase 0 test, version 1
 *   there and no reconversion), else an upload through the server;
 * - the flow's last copy there → a new version on top (an upload with
 *   If-Match, the way Publicar's real test confirmed: same name = new version);
 * - anything else there → "diferencia": shown, and only replaced when the
 *   approver or an administrator confirms that exact version (rule 2).
 * An upload is confirmed afterwards (Trimble takes a moment). One copy per file
 * at a time. Everything goes to the history: who copied, when, which version.
 */
import { buscarEnCarpeta, ClienteTrimble, crearCarpeta, estadoSubida, explicarEstado, leerCarpeta } from "../compras/cde";
import { fechaHora } from "../compras/formato";
import { copiarUltimaVersion, leerArchivo } from "../publicar/copiar";
import { esIdTrimble, FlujoError } from "./errores";
import type { Ctx } from "./service";
import { carpetaDeRevision, chocaConRevision, puedeTrasladar, situacionDestino, subcarpetas, trasladoInicial } from "./traslado";
import type { ArchivoRegistro, CarpetaFlujo, EntradaHistorial, Traslado } from "./types";

/** How long one copy holds its file (a stuck one frees itself). */
const TOMA_MS = 6 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultadoTraslado {
  traslado: Traslado | null;
  mensaje: string;
}

/** "Torre 1/Planos" under a folder, creating what's missing (null: Trimble refused). */
async function asegurarRuta(c: ClienteTrimble, baseId: string, nombres: string[]): Promise<string | null> {
  let actual = baseId;
  for (const nombre of nombres) {
    const existente = await buscarEnCarpeta(c, actual, nombre, "FOLDER");
    if (existente) {
      actual = existente.id;
      continue;
    }
    const { carpeta: padre } = await leerCarpeta(c, actual);
    if (!padre) return null;
    const nueva = (await crearCarpeta(c, padre, nombre)).carpeta?.id;
    if (!nueva) return null;
    actual = nueva;
  }
  return actual;
}

async function archivoDe(ctx: Ctx, archivoId: unknown): Promise<ArchivoRegistro> {
  if (typeof archivoId !== "string" || !UUID.test(archivoId)) throw new FlujoError("El archivo no es válido.");
  const a = (await ctx.store.archivos(ctx.projectId)).find((x) => x.id === archivoId);
  if (!a) throw new FlujoError("Ese archivo no está registrado en este proyecto.", 404);
  return a;
}

/**
 * A folder chosen to put an approved version in: of this project, where
 * Trimble doesn't give the caller read-only access (the owner: "previamente
 * debe tener acceso o autorización del sistema"; Trimble also refuses the copy
 * without permission), and not where the copy would come back to review.
 */
export async function carpetaElegida(ctx: Ctx, a: ArchivoRegistro, carpetaId: unknown): Promise<CarpetaFlujo> {
  if (!esIdTrimble(carpetaId)) throw new FlujoError("La carpeta elegida no es válida.");
  const c = await ctx.tc.carpeta(carpetaId);
  if (c.permiso === "READ") {
    throw new FlujoError(`Solo tienes lectura en «${c.ruta}»: elige una carpeta donde Trimble te deje subir archivos (acceso completo), o pide ese permiso en Trimble.`, 403, "sin-acceso");
  }
  const [registrados, flujos] = await Promise.all([ctx.store.archivos(ctx.projectId), ctx.store.flujos(ctx.projectId)]);
  const choca = chocaConRevision(a, c, registrados, flujos);
  if (choca) throw new FlujoError(choca, 409, "carpeta-en-revision");
  return { id: c.id, ruta: c.ruta, ancestros: c.ancestros };
}

async function anotar(ctx: Ctx, a: ArchivoRegistro, accion: string, detalle: string, momento: string) {
  const linea: Omit<EntradaHistorial, "id" | "creado"> = {
    proyecto: ctx.projectId,
    flujoId: a.flujoId,
    accion,
    usuario: ctx.caller.name,
    usuarioId: ctx.caller.id,
    detalle,
    archivoId: a.id,
    fileId: a.fileId,
    version: a.revisionAprobada,
    ocurrido: momento,
  };
  await ctx.store.registrar(linea);
}

/**
 * Copies the approved version of a file: to its flow's destination (older
 * flows) or to `carpetaId`, the folder chosen (else the last one used for this
 * file: a retry, or a new approved version going where the previous one went).
 * `reemplazar`: the version of another file with that name there that the
 * person saw and confirmed to put a new version on top of.
 */
export async function trasladar(ctx: Ctx, archivoId: unknown, opciones: { reemplazar?: string | null; carpetaId?: string | null } = {}): Promise<ResultadoTraslado> {
  const a = await archivoDe(ctx, archivoId);
  const no = puedeTrasladar(a, { id: ctx.caller.id, esAdmin: ctx.caller.isAdmin });
  if (no) throw new FlujoError(no, 403, "sin-permiso");
  if (a.traslado?.estado === "hecho" && a.traslado.versionId === a.versionAprobadaId) {
    return { traslado: a.traslado, mensaje: `La versión aprobada ya está en «${a.traslado.carpetaRuta || "la carpeta destino"}».` };
  }
  if (a.traslado?.estado === "en-curso" && a.traslado.versionId === a.versionAprobadaId) return confirmarTraslado(ctx, a.id);
  const flujo = await ctx.store.flujo(a.flujoId);
  if (!flujo) throw new FlujoError("El flujo de este archivo ya no existe.", 404);
  // Flows made since 09-11-2026: the folder the responsible chose (checked before anything is copied).
  const destino = flujo.destino;
  let elegida: CarpetaFlujo | null = null;
  if (!destino) {
    const id = opciones.carpetaId || a.traslado?.carpetaId;
    if (!id) throw new FlujoError("Elige la carpeta donde poner la versión aprobada.", 400, "sin-carpeta");
    elegida = await carpetaElegida(ctx, a, id);
  }

  const inicio = ctx.ahora?.() ?? new Date();
  const momento = inicio.toISOString();
  if (!(await ctx.store.tomarTraslado(a.id, new Date(inicio.getTime() + TOMA_MS).toISOString(), momento))) {
    throw new FlujoError("Otra persona está copiando este archivo en este momento.", 409, "ocupado");
  }
  const base = trasladoInicial(a);
  const guardar = async (t: Traslado) => (await ctx.store.actualizarArchivo(a.id, { traslado: t })).traslado;
  try {
    const { lado } = ctx.tc;
    let carpetaId: string | null;
    let carpetaRuta: string;
    if (destino) {
      const carpeta = carpetaDeRevision(a, flujo);
      const subs = carpeta ? subcarpetas(a, carpeta) : [];
      carpetaRuta = [destino.ruta, ...subs].join(" / ");
      carpetaId = await asegurarRuta(lado.cliente, destino.id, subs);
    } else {
      carpetaId = elegida!.id;
      carpetaRuta = elegida!.ruta;
    }
    if (!carpetaId) {
      const mensaje = `No se pudo abrir o crear «${carpetaRuta}» en la carpeta destino: revisa que quien aprueba pueda escribir ahí.`;
      await anotar(ctx, a, "traslado-error", mensaje, momento);
      return { traslado: await guardar({ ...base, estado: "error", mensaje, carpetaRuta }), mensaje };
    }
    const leido = await leerArchivo(lado.cliente, a.fileId);
    if (!leido.archivo) {
      const mensaje = `No se pudo leer el archivo en Trimble: ${explicarEstado(leido.respuesta.estado)}`;
      await anotar(ctx, a, "traslado-error", mensaje, momento);
      return { traslado: await guardar({ ...base, estado: "error", mensaje, carpetaId, carpetaRuta }), mensaje };
    }
    // The approved version, not necessarily the latest one.
    const origen = { ...leido.archivo, versionId: a.versionAprobadaId, revision: a.revisionAprobada };
    const enDestino = await buscarEnCarpeta(lado.cliente, carpetaId, a.nombre, "FILE");
    const situacion = situacionDestino(a.traslado, enDestino, opciones.reemplazar ?? null);
    const donde = destino ? "en el destino" : "ahí";

    if (situacion === "diferencia" && enDestino) {
      const otro = (await leerArchivo(lado.cliente, enDestino.id)).archivo;
      const quien = [otro?.modificadoPor, otro?.modificado ? fechaHora(otro.modificado) : ""].filter(Boolean).join(", ");
      const nuestra = a.traslado?.destinoVersionId ? "cambió después de la última copia del flujo" : "no llegó por este flujo";
      const diferenciaTexto = `En «${carpetaRuta}» ya hay un «${a.nombre}» que ${nuestra} (versión ${otro?.revision ?? "?"}${quien ? `, ${quien}` : ""}). No se reemplaza sin confirmación.`;
      await anotar(ctx, a, "traslado-diferencia", diferenciaTexto, momento);
      return {
        traslado: await guardar({ ...base, estado: "diferencia", mensaje: diferenciaTexto, carpetaId, carpetaRuta, diferenciaVersionId: enDestino.versionId, diferenciaTexto }),
        mensaje: diferenciaTexto,
      };
    }

    const copiar = (sinModelo: boolean) =>
      copiarUltimaVersion({
        origen: lado,
        destino: lado,
        archivo: origen,
        carpetaId,
        enDestino: situacion === "version-nueva" && enDestino ? { versionId: enDestino.versionId } : null,
        soloSubida: situacion === "version-nueva",
        versionFija: true,
        sinModelo,
        fetch: ctx.tc.fetch,
      });
    let r = await copiar(false);
    if (r.reintentarSinModelo) r = await copiar(true);
    if (!r.ok) {
      await anotar(ctx, a, "traslado-error", `No se pudo copiar la versión ${a.revisionAprobada ?? "?"} a «${carpetaRuta}»: ${r.mensaje}`, momento);
      return { traslado: await guardar({ ...base, estado: "error", mensaje: r.mensaje, carpetaId, carpetaRuta }), mensaje: `No se pudo copiar a «${carpetaRuta}»: ${r.mensaje}` };
    }
    if (r.metodo === "trimble") {
      const detalle = destino
        ? `Copió la versión ${a.revisionAprobada ?? "?"} a «${carpetaRuta}»: versión ${r.revision ?? "?"} en el destino (copia dentro de Trimble).`
        : `Puso la versión ${a.revisionAprobada ?? "?"} aprobada en «${carpetaRuta}», la carpeta que eligió: versión ${r.revision ?? "?"} ahí (copia dentro de Trimble).`;
      await anotar(ctx, a, "trasladado", detalle, momento);
      const t = await guardar({
        ...base,
        estado: "hecho",
        mensaje: detalle,
        carpetaId,
        carpetaRuta,
        destinoFileId: r.fileId ?? null,
        destinoVersionId: r.versionId ?? null,
        destinoRevision: r.revision ?? null,
        por: ctx.caller.name,
        porId: ctx.caller.id,
        fecha: momento,
      });
      return { traslado: t, mensaje: `Copiado a «${carpetaRuta}» (versión ${r.revision ?? "?"} ${donde}).` };
    }
    const t = await guardar({ ...base, estado: "en-curso", mensaje: r.mensaje, carpetaId, carpetaRuta, uploadId: r.uploadId ?? null, por: ctx.caller.name, porId: ctx.caller.id, fecha: momento });
    return { traslado: t, mensaje: `Copiando a «${carpetaRuta}»: Trimble está recibiendo la versión ${a.revisionAprobada ?? "?"}.` };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await anotar(ctx, a, "traslado-error", `No se pudo copiar: ${mensaje}`, momento);
    return { traslado: await guardar({ ...base, estado: "error", mensaje }), mensaje: `No se pudo copiar: ${mensaje}` };
  } finally {
    await ctx.store.soltarTraslado(a.id);
  }
}

/** Asks Trimble how an upload to the folder went, and records it when done. */
export async function confirmarTraslado(ctx: Ctx, archivoId: unknown): Promise<ResultadoTraslado> {
  const a = await archivoDe(ctx, archivoId);
  const t = a.traslado;
  if (!t || t.estado !== "en-curso" || !t.uploadId) return { traslado: t, mensaje: "" };
  const s = await estadoSubida(ctx.tc.lado.cliente, t.uploadId);
  const momento = (ctx.ahora?.() ?? new Date()).toISOString();
  if (s.status === "DONE") {
    const detalle = `Copió la versión ${t.revision ?? "?"} aprobada a «${t.carpetaRuta}»: versión ${s.revision ?? "?"} ahí.`;
    await anotar(ctx, a, "trasladado", detalle, momento);
    const hecho = await ctx.store.actualizarArchivo(a.id, {
      traslado: { ...t, estado: "hecho", mensaje: detalle, uploadId: null, destinoFileId: s.fileId, destinoVersionId: s.versionId, destinoRevision: s.revision, fecha: momento, diferenciaVersionId: null, diferenciaTexto: "" },
    });
    return { traslado: hecho.traslado, mensaje: `Copiado a «${t.carpetaRuta}» (versión ${s.revision ?? "?"} ahí).` };
  }
  if (s.status === "ERROR" || s.status === "EXPIRED") {
    const mensaje = s.status === "ERROR" ? `Trimble marcó error en la carga: ${s.errorReason ?? "sin detalle"}.` : "La carga venció sin terminar.";
    await anotar(ctx, a, "traslado-error", `${mensaje} (versión ${t.revision ?? "?"} a «${t.carpetaRuta}»)`, momento);
    const malo = await ctx.store.actualizarArchivo(a.id, { traslado: { ...t, estado: "error", mensaje, uploadId: null } });
    return { traslado: malo.traslado, mensaje };
  }
  if (s.respuesta.estado === 403 || s.respuesta.estado === 404) return { traslado: t, mensaje: "Trimble no deja ver esa carga con tu usuario: la confirma quien la inició." };
  return { traslado: t, mensaje: "Trimble todavía está recibiendo la copia." };
}

/** { archivoId, paso: trasladar | confirmar | reemplazar, siVersion, carpetaId }: what the screen asks for. */
export async function pasoTraslado(ctx: Ctx, body: unknown): Promise<ResultadoTraslado> {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (o.paso === "confirmar") return confirmarTraslado(ctx, o.archivoId);
  if (o.paso === "reemplazar") {
    if (typeof o.siVersion !== "string" || !o.siVersion) throw new FlujoError("Falta la versión del destino que viste.");
    return trasladar(ctx, o.archivoId, { reemplazar: o.siVersion });
  }
  if (o.paso === "trasladar") return trasladar(ctx, o.archivoId, { carpetaId: typeof o.carpetaId === "string" && o.carpetaId ? o.carpetaId : null });
  throw new FlujoError("Paso no válido.");
}
