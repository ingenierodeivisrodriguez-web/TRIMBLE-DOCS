/**
 * The e-mail's button that opens the exact flow (phase 3 of the e-mails,
 * 12-11-2026). Trimble has no address that opens an extension on a given
 * screen, so each e-mail carries its own link (a random token, one per person):
 * the button goes through this app, which notes the click and sends the person
 * on to the extension in Trimble Connect; when the extension opens, it asks
 * whether that same Trimble user clicked a button in the last minutes and, if
 * so, opens that flow. The link also keeps who was written to (and their
 * address), which the daily reminder uses, since it runs without a Trimble session.
 */
import { fechaHora } from "../compras/formato";
import { conInicial } from "./configCorreo";
import { enlaceExtension, ID_EXTENSION } from "./correo";
import type { Ctx } from "./service";
import type { FlujoStore } from "./store";

export type TipoEnlace = "revision" | "correccion" | "prueba" | "recordatorio";

/** The link of one e-mail to one person. */
export interface EnlaceCorreo {
  token: string;
  proyecto: string;
  /** The flow it opens (null: the test e-mail, or a reminder about several flows). */
  flujoId: string | null;
  /** The Trimble user it was written to: only they get the flow opened. */
  usuarioId: string;
  nombre: string;
  correo: string | null;
  tipo: TipoEnlace;
  /** The registered files of the notice, and the step they waited for (for the reminder). */
  archivos: string[];
  pasoId: string | null;
  proyectoNombre: string;
  creado: string;
  expira: string;
  /** The last click on the button. */
  abierto: string | null;
  /** When the extension opened the flow from it (once). */
  usado: string | null;
  /** The last day ("AAAA-MM-DD") a reminder went for it. */
  recordado: string | null;
}

/** Days a button keeps working. */
export const DIAS_ENLACE = 60;
/** Minutes between the click and the extension opening (Trimble may ask to sign in first). */
export const MINUTOS_CLIC = 20;
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

/** 24 random bytes in base64url: nobody can guess one. */
export function nuevoToken(): string {
  const b = new Uint8Array(24);
  globalThis.crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The address of a link: through this app, which sends on to Trimble. */
export const rutaEnlace = (origen: string, token: string) => `${origen.replace(/\/+$/, "")}/api/flujo-aprobacion/ir/${token}`;

/** Saves the link of one e-mail for one person and returns its address. */
export async function crearEnlace(
  store: FlujoStore,
  origen: string,
  datos: Pick<EnlaceCorreo, "proyecto" | "flujoId" | "usuarioId" | "nombre" | "correo" | "tipo" | "archivos" | "pasoId" | "proyectoNombre">,
  ahora: Date
): Promise<string> {
  const token = nuevoToken();
  await store.crearEnlace({
    ...datos,
    token,
    creado: ahora.toISOString(),
    expira: new Date(ahora.getTime() + DIAS_ENLACE * 86_400_000).toISOString(),
    abierto: null,
    usado: null,
    recordado: null,
  });
  return rutaEnlace(origen, token);
}

/**
 * The click on an e-mail's button (no session: the token is the key): notes it
 * and says where to send the person (the extension in that project), or null
 * when the link doesn't exist or expired.
 */
export async function abrirEnlace(store: FlujoStore, token: string, ahora: Date, idPorDefecto: string = ID_EXTENSION): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const e = await store.enlace(token);
  if (!e || e.expira < ahora.toISOString()) return null;
  await store.marcarEnlaceAbierto(token, ahora.toISOString());
  const config = conInicial((await store.configCorreo(e.proyecto).catch(() => null))?.datos);
  return enlaceExtension(e.proyecto, config.idExtension ?? idPorDefecto);
}

const QUE: Record<TipoEnlace, string> = {
  revision: "correo «te toca»",
  correccion: "correo de rechazo",
  recordatorio: "recordatorio de vencidos",
  prueba: "correo de prueba",
};

/** What the extension does when it opens: open a flow, show the files waiting for the person, say something. */
export interface Pendiente {
  flujoId: string | null;
  porRevisar: boolean;
  mensaje: string | null;
}

/**
 * When the extension opens: the flow the caller asked for with an e-mail's
 * button in the last minutes (each click opens it once). Never fails: the
 * extension opens as always.
 */
export async function tomarPendiente(ctx: Ctx): Promise<Pendiente> {
  const nada: Pendiente = { flujoId: null, porRevisar: false, mensaje: null };
  const ahora = ctx.ahora?.() ?? new Date();
  const desde = new Date(ahora.getTime() - MINUTOS_CLIC * 60_000).toISOString();
  const e = await ctx.store.enlacePendiente(ctx.projectId, ctx.caller.id, desde).catch(() => null);
  if (!e || !(await ctx.store.marcarEnlaceUsado(e.token, ahora.toISOString()).catch(() => false))) return nada;
  if (e.tipo === "prueba") return { ...nada, mensaje: "Entraste con el botón del correo de prueba: el botón funciona." };
  const flujo = e.flujoId ? await ctx.store.flujo(e.flujoId).catch(() => null) : null;
  if (!flujo || flujo.proyecto !== ctx.projectId) return { ...nada, porRevisar: e.tipo === "recordatorio" };
  await ctx.store
    .registrar({
      proyecto: ctx.projectId,
      flujoId: flujo.id,
      accion: "entro-desde-correo",
      usuario: ctx.caller.name,
      usuarioId: ctx.caller.id,
      detalle: `Entró al flujo con el botón del ${QUE[e.tipo]} enviado el ${fechaHora(e.creado)}.`,
    })
    .catch(() => undefined);
  return { ...nada, flujoId: flujo.id };
}
