/**
 * The extension's own e-mails (11-11-2026, the owner's wish): besides the
 * Trimble ToDo, the person whose turn it is gets an e-mail sent by the
 * extension from its own Gmail account, with the flow, the step, the files and
 * a button that opens the extension in Trimble Connect. They go at the same
 * moments as the ToDos (a file enters a step, the next step, a rejection) and
 * never block anything: a failure is noted in the history.
 */
import type { ProjectUser } from "../trimbleApi";
import { FlujoError } from "./errores";
import { diaVisible } from "./flujos";
import type { Ctx } from "./service";
import type { Aviso } from "./types";

/**
 * The extension's id in Trimble Connect, part of its address: taken from the
 * address the owner copied with the extension open (11-11-2026). Trimble may
 * give it another id in another project; `FLUJO_EXTENSION_ID` in Vercel
 * replaces it.
 */
export const ID_EXTENSION = "8e7cd6d3-3e0e-16d7-12f4-02d6a673090e";
/** The manifest's menu command, the last part of that address. */
export const COMANDO_EXTENSION = "flujo_aprobacion_open";

/** The address that opens "Flujo de aprobación" in that project of Trimble Connect. */
export function enlaceExtension(projectId: string, idExtension: string = ID_EXTENSION): string {
  return `https://web.connect.trimble.com/projects/${encodeURIComponent(projectId)}/extension/${encodeURIComponent(idExtension)}/${COMANDO_EXTENSION}`;
}

/** One e-mail to one person. */
export interface MensajeCorreo {
  para: { nombre: string; correo: string };
  asunto: string;
  texto: string;
  html: string;
}

/** How the server sends e-mails (Gmail with the Vercel variables; a fake one in tests). */
export interface Correo {
  /** The sending address, to say where the e-mails come from. */
  desde: string;
  /** Another extension id for the links (`FLUJO_EXTENSION_ID`). */
  idExtension?: string;
  /** Sends one e-mail; throws when it can't. */
  enviar(m: MensajeCorreo): Promise<void>;
}

/** What the e-mail of a notice says (built with the ToDo, from the same data). */
export interface DatosCorreo {
  tipo: "revision" | "correccion";
  /** «FLUJO-01», or "" for a flow without code. */
  codigo: string;
  hito: string;
  notas: string;
  /** "AAAA-MM-DD" or null. */
  vence: string | null;
  /** The step that waits (revision) or that rejected (correccion). */
  paso: string;
  archivos: { nombre: string; revision: number | null; enlace: string; nueva: boolean }[];
  /** Files left out of the list. */
  mas: number;
  /** correccion: who rejected, why, and the file's folder. */
  rechazo?: { quien: string; motivo: string; carpeta: string };
  /** The test e-mail of «Enviar correo de prueba». */
  prueba?: boolean;
}

/** Files listed in one e-mail; the rest are counted. */
export const MAX_EN_CORREO = 15;
/** People written to for one notice (a big group doesn't flood the sending account). */
export const MAX_DESTINATARIOS = 25;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text written by people, safe inside the e-mail's HTML. */
export const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
const unaLinea = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The subject: the code first, so the person finds the flow («FLUJO-01 · Te toca «Revisa»: Planos torre 1»). */
export function asuntoCorreo(d: DatosCorreo): string {
  const antes = d.codigo ? `${d.codigo} · ` : "";
  const asunto = d.prueba
    ? "Correo de prueba de Flujo de aprobación"
    : d.tipo === "correccion"
      ? `${antes}Rechazado: corrige «${d.archivos[0]?.nombre ?? ""}» — ${d.hito}`
      : `${antes}Te toca «${d.paso}»: ${d.hito}`;
  return recorte(unaLinea(asunto), 160);
}

const AZUL = "#2f4f8f";
const GRIS = "#6a7686";

function boton(texto: string, enlace: string, principal: boolean): string {
  const estilo = principal
    ? `background:${AZUL};color:#ffffff;border:1px solid ${AZUL}`
    : `background:#ffffff;color:${AZUL};border:1px solid ${AZUL}`;
  return `<a href="${escapar(enlace)}" style="${estilo};display:inline-block;padding:10px 20px;border-radius:3px;text-decoration:none;font-weight:600;font-size:14px;margin:0 8px 8px 0">${escapar(texto)}</a>`;
}

/**
 * The e-mail of a notice for one person: subject, plain text and HTML (with
 * inline styles, which is what e-mail programs read). Everything people wrote
 * (title, description, names, reason) is escaped.
 */
export function armarCorreo(d: DatosCorreo, quien: { nombre: string }, comun: { proyecto: string; enlace: string }): { asunto: string; texto: string; html: string } {
  const asunto = asuntoCorreo(d);
  const hola = `Hola${quien.nombre ? ` ${unaLinea(quien.nombre)}` : ""},`;
  const archivo = d.archivos[0];
  const intro = d.prueba
    ? "Este es un correo de prueba de la extensión Flujo de aprobación. Así llegarán los avisos cuando a alguien le toque un paso. Prueba el botón de abajo: debe abrir la extensión en este proyecto de Trimble Connect."
    : d.tipo === "correccion" && d.rechazo
      ? `${unaLinea(d.rechazo.quien)} rechazó la versión ${archivo?.revision ?? "?"} de «${archivo?.nombre ?? ""}» en el paso «${d.paso}» del flujo:`
      : `Te toca el paso «${d.paso}» del flujo:`;
  const vence = d.vence ? diaVisible(d.vence) : "";
  const notas = d.notas.trim();
  const lineaArchivo = (a: DatosCorreo["archivos"][number]) => `${a.nombre} — versión ${a.revision ?? "?"}${a.nueva ? " (versión nueva)" : ""}`;
  const archivos = d.archivos.slice(0, MAX_EN_CORREO);
  const mas = d.mas + Math.max(0, d.archivos.length - MAX_EN_CORREO);
  const comoSigue =
    d.tipo === "correccion" && d.rechazo
      ? `Corrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta (${d.rechazo.carpeta}).`
      : d.prueba
        ? ""
        : `En la extensión: flujo ${d.codigo ? `${d.codigo} ` : ""}«${unaLinea(d.hito)}» → Archivos → Me toca → Decidir.`;
  const pie = "Este correo lo envía la extensión Flujo de aprobación de Trimble Connect. No lo respondas: los comentarios van en el flujo.";

  const texto = [
    hola,
    "",
    intro,
    ...(d.prueba ? [] : [`${d.codigo ? `${d.codigo} — ` : ""}${unaLinea(d.hito)}`]),
    `Proyecto: ${comun.proyecto}`,
    ...(notas && !d.prueba ? ["", notas] : []),
    ...(vence ? [`Vence: ${vence}`] : []),
    ...(d.tipo === "correccion" && d.rechazo ? ["", `Motivo: ${d.rechazo.motivo}`] : []),
    ...(archivos.length ? ["", "Archivos:", ...archivos.map((a) => `• ${lineaArchivo(a)}: ${a.enlace}`)] : []),
    ...(mas ? [`… y ${mas} más.`] : []),
    ...(comoSigue ? ["", comoSigue] : []),
    "",
    `Abrir Flujo de aprobación: ${comun.enlace}`,
    "",
    "—",
    pie,
  ].join("\n");

  const p = (contenido: string, estilo = "") => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#2b3645;${estilo}">${contenido}</p>`;
  const html = [
    `<div style="background:#f4f6f9;padding:24px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif">`,
    `<div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #dfe4ea;border-radius:6px;overflow:hidden">`,
    `<div style="background:${AZUL};color:#ffffff;padding:14px 22px;font-size:15px;font-weight:600">Flujo de aprobación<span style="font-weight:400;opacity:.85"> · ${escapar(comun.proyecto)}</span></div>`,
    `<div style="padding:22px">`,
    p(escapar(hola)),
    p(escapar(intro)),
    d.prueba
      ? ""
      : `<div style="border-left:3px solid ${AZUL};padding:4px 0 4px 12px;margin:0 0 14px">${d.codigo ? `<div style="font-size:12px;color:${GRIS};letter-spacing:.3px">${escapar(d.codigo)}</div>` : ""}<div style="font-size:17px;font-weight:600;color:#1f2a38">${escapar(unaLinea(d.hito))}</div>${
          notas ? `<div style="font-size:13.5px;color:#3d4a5c;margin-top:4px;white-space:pre-line">${escapar(notas)}</div>` : ""
        }</div>`,
    vence ? p(`Vence: <b>${escapar(vence)}</b>`) : "",
    d.tipo === "correccion" && d.rechazo ? p(`<b>Motivo:</b> ${escapar(d.rechazo.motivo)}`, "background:#fdecec;border-radius:4px;padding:8px 10px") : "",
    archivos.length
      ? `${p("Archivos:", "margin-bottom:4px")}<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6;color:#2b3645">${archivos
          .map((a) => `<li><a href="${escapar(a.enlace)}" style="color:${AZUL}">${escapar(a.nombre)}</a> — versión ${a.revision ?? "?"}${a.nueva ? " (versión nueva)" : ""}</li>`)
          .join("")}</ul>`
      : "",
    mas ? p(`… y ${mas} más.`) : "",
    comoSigue ? p(escapar(comoSigue), `color:${GRIS};font-size:13px`) : "",
    `<div style="margin:18px 0 4px">${boton("Abrir Flujo de aprobación", comun.enlace, true)}${
      d.tipo === "correccion" && archivo ? boton("Abrir el archivo", archivo.enlace, false) : ""
    }</div>`,
    `</div>`,
    `<div style="padding:12px 22px;background:#f7f9fb;border-top:1px solid #eef1f5;font-size:12px;color:#8a95a5">${escapar(pie)}</div>`,
    `</div></div>`,
  ].join("");
  return { asunto, texto, html };
}

/** Someone an e-mail goes to, with their address as Trimble has it (null: Trimble has none). */
export interface Destinatario {
  id: string;
  nombre: string;
  correo: string | null;
}

const CORREO_VALIDO = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const nombreDe = (p: ProjectUser) => unaLinea(`${p.firstName ?? ""} ${p.lastName ?? ""}`) || p.email || p.id;

/**
 * The people of a notice with their e-mail: each person, and every member of
 * each group, once each; people removed from the project are left out.
 */
export async function destinatarios(para: Aviso["para"], personas: () => Promise<ProjectUser[]>, miembros: (groupId: string) => Promise<ProjectUser[]>): Promise<Destinatario[]> {
  const out = new Map<string, Destinatario>();
  const vale = (p: ProjectUser) => (p.status ?? "ACTIVE").toUpperCase() !== "REMOVED";
  const agregar = (p: ProjectUser) => {
    if (!vale(p) || out.has(p.id)) return;
    const correo = (p.email ?? "").trim();
    out.set(p.id, { id: p.id, nombre: nombreDe(p), correo: CORREO_VALIDO.test(correo) ? correo : null });
  };
  const solas = para.filter((p) => p.tipo === "persona");
  if (solas.length) {
    const todas = new Map((await personas()).map((p) => [p.id, p]));
    for (const s of solas) {
      const p = todas.get(s.id);
      if (p) agregar(p);
      else if (!out.has(s.id)) out.set(s.id, { id: s.id, nombre: s.nombre, correo: null });
    }
  }
  for (const g of para.filter((p) => p.tipo === "grupo")) for (const m of await miembros(g.id)) agregar(m);
  return [...out.values()];
}

/** What went wrong sending, in words (nodemailer's codes for Gmail). */
export function mensajeErrorCorreo(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const respuesta = typeof e.responseCode === "number" ? e.responseCode : null;
  if (code === "EAUTH" || respuesta === 535 || respuesta === 534) {
    return "Gmail no aceptó el usuario o la clave: revisa en Vercel FLUJO_CORREO_USUARIO y FLUJO_CORREO_CLAVE (la contraseña de aplicación de 16 letras, no la clave normal)";
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") return "no se pudo conectar con Gmail; se intenta otra vez en el próximo aviso";
  if (code === "EENVELOPE" || respuesta === 550 || respuesta === 553) return "Gmail rechazó la dirección del destinatario";
  if (respuesta === 421 || respuesta === 454 || respuesta === 452) return "Gmail no recibe más correos por ahora (límite diario de la cuenta)";
  const texto = typeof e.message === "string" ? e.message : String(err);
  return recorte(unaLinea(texto), 200) || "error desconocido";
}

const persona = (d: Destinatario) => (d.correo ? `${d.nombre} <${d.correo}>` : d.nombre);

/**
 * Sends the e-mail of a notice to each of its people, one by one (each with
 * their own name; nobody sees the others' addresses). Never throws: says what
 * happened, for the history.
 */
export async function enviarCorreos(correo: Correo, d: DatosCorreo, gente: Destinatario[], comun: { proyecto: string; enlace: string }): Promise<{ ok: boolean; enviados: number; mensaje: string }> {
  const asunto = asuntoCorreo(d);
  const conCorreo = gente.filter((g) => g.correo).slice(0, MAX_DESTINATARIOS);
  const sinCorreo = gente.filter((g) => !g.correo);
  const fuera = gente.filter((g) => g.correo).length - conCorreo.length;
  const bien: Destinatario[] = [];
  const mal: { d: Destinatario; error: string }[] = [];
  for (const g of conCorreo) {
    try {
      const m = armarCorreo(d, g, comun);
      await correo.enviar({ para: { nombre: g.nombre, correo: g.correo! }, ...m });
      bien.push(g);
    } catch (err) {
      mal.push({ d: g, error: mensajeErrorCorreo(err) });
      // A wrong key fails the same way for everyone: don't try the rest.
      if ((err as { code?: unknown } | null)?.code === "EAUTH") {
        for (const r of conCorreo.slice(conCorreo.indexOf(g) + 1)) mal.push({ d: r, error: "no se intentó" });
        break;
      }
    }
  }
  const partes: string[] = [];
  if (bien.length) partes.push(`Correo a ${bien.map(persona).join(", ")}: «${asunto}»`);
  if (mal.length) {
    const errores = [...new Set(mal.map((m) => m.error).filter((e) => e !== "no se intentó"))];
    partes.push(`${bien.length ? "no se pudo enviar" : `No se pudo enviar el correo «${asunto}»`} a ${mal.map((m) => persona(m.d)).join(", ")}: ${errores.join("; ")}`);
  }
  if (sinCorreo.length) partes.push(`${partes.length ? "sin" : `No se envió el correo «${asunto}»: sin`} correo en Trimble: ${sinCorreo.map((s) => s.nombre).join(", ")}`);
  if (fuera) partes.push(`no se escribió a ${fuera} más (límite de ${MAX_DESTINATARIOS} por aviso)`);
  if (!partes.length) partes.push(`No se envió el correo «${asunto}»: el aviso no tiene a quién`);
  return { ok: bien.length > 0 && !mal.length, enviados: bien.length, mensaje: `${partes.join("; ")}.` };
}

/**
 * «Enviar correo de prueba» (administrators): sends a sample to the caller's
 * own address, to check the Gmail key in Vercel and the extension's button.
 */
export async function correoPrueba(ctx: Ctx): Promise<{ mensaje: string }> {
  if (!ctx.caller.isAdmin) throw new FlujoError("Solo un administrador del proyecto en Trimble envía el correo de prueba.", 403, "sin-permiso");
  if (!ctx.correo) {
    throw new FlujoError(
      "El correo no está configurado: en Vercel faltan las variables FLUJO_CORREO_USUARIO y FLUJO_CORREO_CLAVE (o se pusieron después de la última publicación y falta publicar otra vez).",
      409,
      "correo-sin-configurar"
    );
  }
  const [yo] = await destinatarios([{ tipo: "persona", id: ctx.caller.id, nombre: ctx.caller.name }], () => ctx.tc.personas(), async () => []);
  if (!yo?.correo) throw new FlujoError("Trimble no tiene tu correo en el equipo del proyecto: no hay a dónde enviar la prueba.", 409, "sin-correo");
  const proyecto = (await ctx.tc.nombreProyecto?.().catch(() => "")) || "Trimble Connect";
  const d: DatosCorreo = { tipo: "revision", codigo: "", hito: "Correo de prueba", notas: "", vence: null, paso: "", archivos: [], mas: 0, prueba: true };
  try {
    await ctx.correo.enviar({ para: { nombre: yo.nombre, correo: yo.correo }, ...armarCorreo(d, yo, { proyecto, enlace: enlaceExtension(ctx.projectId, ctx.correo.idExtension) }) });
  } catch (err) {
    throw new FlujoError(`No se pudo enviar el correo de prueba: ${mensajeErrorCorreo(err)}.`, 502, "correo-fallido");
  }
  return {
    mensaje: `Te envié un correo de prueba a ${yo.correo}, desde ${ctx.correo.desde}. Revísalo (mira también la carpeta de spam la primera vez) y prueba su botón «Abrir Flujo de aprobación».`,
  };
}
