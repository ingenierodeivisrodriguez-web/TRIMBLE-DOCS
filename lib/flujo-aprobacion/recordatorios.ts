/**
 * The daily reminder (phase 3 of the e-mails, 12-11-2026): once a day (Vercel
 * Cron) each person with files that wait for their step in a flow whose due
 * date passed gets one e-mail per project with those files. It runs without a
 * Trimble session, so it writes to the people the «te toca» e-mail of that file
 * and step went to, at the address it went to (kept with each e-mail's link);
 * steps notified before phase 3 have no such record and get no reminder. At
 * most one reminder per person and link a day; each one goes to the flow's history.
 */
import { conInicial } from "./configCorreo";
import { botonCorreo, bloqueFlujo, Correo, enlaceExtension, escapar, ID_EXTENSION, marcoCorreo, mensajeErrorCorreo, parrafoCorreo, textoBoton } from "./correo";
import { enlaceDe } from "./decisiones";
import { crearEnlace, EnlaceCorreo } from "./enlaces";
import { codigoFlujo, diaVisible } from "./flujos";
import { NOMBRE_EXTENSION } from "./nombre";
import { ESPERANDO } from "./registro";
import type { FlujoStore } from "./store";
import { diaColombia } from "./trazabilidad";
import type { ArchivoRegistro, EntradaHistorial, Flujo } from "./types";

/** Reminders in one run (Gmail lets about 500 e-mails a day). */
export const MAX_RECORDATORIOS = 200;
/** Who the history says sent it. */
export const QUIEN_RECUERDA = "Recordatorio automático";

export interface DepsRecordatorios {
  store: FlujoStore;
  /** Missing: Vercel has no Gmail account, nothing goes. */
  correo?: Correo;
  /** This app's public address, for each reminder's own link. */
  origen: string | null;
  ahora: Date;
  /** The extension id when the project didn't set one (\`FLUJO_EXTENSION_ID\`). */
  idPorDefecto?: string;
}

/** One overdue flow in a person's reminder, with the files waiting for them. */
export interface VencidoFlujo {
  flujo: Pick<Flujo, "id" | "codigo" | "hito" | "vence">;
  paso: string;
  archivos: Pick<ArchivoRegistro, "id" | "nombre" | "revision" | "fileId" | "tipo" | "versionId">[];
}

const dias = (desde: string, hasta: string) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000));
const haceDias = (n: number) => (n === 1 ? "hace 1 día" : `hace ${n} días`);

/** The reminder for one person: subject, plain text and HTML. */
export function armarRecordatorio(
  quien: { nombre: string },
  vencidos: VencidoFlujo[],
  comun: { proyecto: string; enlace: string; alFlujo: boolean; hoy: string; enlaceArchivo: (a: VencidoFlujo["archivos"][number]) => string }
): { asunto: string; texto: string; html: string } {
  const total = vencidos.reduce((n, v) => n + v.archivos.length, 0);
  const asunto = `Recordatorio: ${total === 1 ? "1 archivo vencido espera" : `${total} archivos vencidos esperan`} tu paso — ${comun.proyecto}`.replace(/[\r\n]+/g, " ").slice(0, 160);
  const hola = `Hola${quien.nombre ? ` ${quien.nombre}` : ""},`;
  const intro = "Estos archivos esperan tu paso y su flujo ya venció:";
  const unico = vencidos.length === 1 ? codigoFlujo(vencidos[0].flujo.codigo) : "";
  const etiqueta = textoBoton(unico, comun.alFlujo);
  const pie = `Este recordatorio llega cada día mientras tengas archivos vencidos esperando tu paso. Lo envía la extensión ${NOMBRE_EXTENSION} de Trimble Connect.`;
  const linea = (v: VencidoFlujo) => `Venció el ${diaVisible(v.flujo.vence ?? "")} (${haceDias(dias(v.flujo.vence ?? comun.hoy, comun.hoy))}) · paso «${v.paso}»`;

  const texto = [
    hola,
    "",
    intro,
    ...vencidos.flatMap((v) => [
      "",
      `${codigoFlujo(v.flujo.codigo) ? `${codigoFlujo(v.flujo.codigo)} — ` : ""}${v.flujo.hito}`,
      linea(v),
      ...v.archivos.map((a) => `• ${a.nombre} — versión ${a.revision ?? "?"}: ${comun.enlaceArchivo(a)}`),
    ]),
    "",
    `${etiqueta}: ${comun.enlace}`,
    "",
    "—",
    pie,
  ].join("\n");

  const contenido = [
    parrafoCorreo(escapar(hola)),
    parrafoCorreo(escapar(intro)),
    ...vencidos.map((v) =>
      bloqueFlujo(
        codigoFlujo(v.flujo.codigo),
        v.flujo.hito,
        "",
        `<div style="font-size:13px;color:#b3261e;margin-top:4px">${escapar(linea(v))}</div><ul style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.6;color:#2b3645">${v.archivos
          .map((a) => `<li><a href="${escapar(comun.enlaceArchivo(a))}" style="color:#2f4f8f">${escapar(a.nombre)}</a> — versión ${a.revision ?? "?"}</li>`)
          .join("")}</ul>`
      )
    ),
    `<div style="margin:18px 0 4px">${botonCorreo(etiqueta, comun.enlace, true)}</div>`,
  ].join("");
  return { asunto, texto, html: marcoCorreo(comun.proyecto, contenido, pie) };
}

type Linea = Omit<EntradaHistorial, "id" | "creado">;

/**
 * Sends the day's reminders of every project that has them on. Never throws
 * for one e-mail: a failure is noted in the history; a wrong Gmail key stops the run.
 */
export async function enviarRecordatorios(d: DepsRecordatorios): Promise<{ proyectos: number; enviados: number; fallidos: number; mensaje: string }> {
  if (!d.correo) return { proyectos: 0, enviados: 0, fallidos: 0, mensaje: "No hay cuenta de Gmail en Vercel: no se envió ningún recordatorio." };
  const correo = d.correo;
  const momento = d.ahora.toISOString();
  const hoy = diaColombia(momento);
  const vencidos = await d.store.flujosVencidos(hoy);
  const porProyecto = new Map<string, Flujo[]>();
  for (const f of vencidos) porProyecto.set(f.proyecto, [...(porProyecto.get(f.proyecto) ?? []), f]);

  let proyectos = 0;
  let enviados = 0;
  let fallidos = 0;
  let detener = false;
  for (const [proyecto, flujos] of porProyecto) {
    if (detener || enviados + fallidos >= MAX_RECORDATORIOS) break;
    const config = conInicial((await d.store.configCorreo(proyecto).catch(() => null))?.datos);
    if (!config.activo || !config.recordatorios) continue;
    const deFlujo = new Map(flujos.map((f) => [f.id, f]));
    const archivos = (await d.store.archivos(proyecto)).filter((a) => deFlujo.has(a.flujoId) && ESPERANDO.includes(a.estado));
    if (!archivos.length) continue;
    const enlaces = await d.store.enlacesRevision(proyecto);

    // Per person: their address, the project's name, the overdue files by flow and the links used.
    const personas = new Map<string, { nombre: string; correo: string; proyectoNombre: string; flujos: Map<string, VencidoFlujo>; tokens: Set<string> }>();
    for (const a of archivos) {
      const paso = a.pasos[a.pasoActual];
      if (!paso) continue;
      const fila = (e: EnlaceCorreo) =>
        e.correo && e.pasoId === paso.id && e.archivos.includes(a.id) && e.recordado !== hoy && (paso.responsable?.tipo !== "persona" || paso.responsable.id === e.usuarioId);
      for (const e of enlaces.filter(fila)) {
        const p = personas.get(e.usuarioId) ?? { nombre: e.nombre, correo: e.correo!, proyectoNombre: e.proyectoNombre, flujos: new Map<string, VencidoFlujo>(), tokens: new Set<string>() };
        // The latest e-mail gives the address and the project's name.
        p.correo = e.correo!;
        p.nombre = e.nombre || p.nombre;
        p.proyectoNombre = e.proyectoNombre || p.proyectoNombre;
        const f = deFlujo.get(a.flujoId)!;
        const v: VencidoFlujo = p.flujos.get(f.id) ?? { flujo: f, paso: paso.nombre, archivos: [] };
        if (!v.archivos.some((x) => x.id === a.id)) v.archivos.push(a);
        p.flujos.set(f.id, v);
        p.tokens.add(e.token);
        personas.set(e.usuarioId, p);
      }
    }
    if (!personas.size) continue;
    proyectos++;

    const lineas: Linea[] = [];
    for (const [usuarioId, p] of personas) {
      if (detener || enviados + fallidos >= MAX_RECORDATORIOS) break;
      const lista = [...p.flujos.values()];
      const unico = lista.length === 1 ? lista[0].flujo.id : null;
      const proyectoNombre = p.proyectoNombre || "Trimble Connect";
      const propio = d.origen
        ? await crearEnlace(
            d.store,
            d.origen,
            { proyecto, flujoId: unico, usuarioId, nombre: p.nombre, correo: p.correo, tipo: "recordatorio", archivos: lista.flatMap((v) => v.archivos.map((a) => a.id)), pasoId: null, proyectoNombre },
            d.ahora
          ).catch(() => null)
        : null;
      const m = armarRecordatorio(p, lista, {
        proyecto: proyectoNombre,
        enlace: propio ?? enlaceExtension(proyecto, config.idExtension ?? d.idPorDefecto ?? ID_EXTENSION),
        alFlujo: !!propio && !!unico,
        hoy,
        enlaceArchivo: (a) => enlaceDe(proyecto, a),
      });
      const para = `${p.nombre} <${p.correo}>`;
      try {
        await correo.enviar({ para: { nombre: p.nombre, correo: p.correo }, ...m });
        enviados++;
        await d.store.marcarRecordado([...p.tokens], hoy);
        for (const v of lista) {
          lineas.push({
            proyecto,
            flujoId: v.flujo.id,
            accion: "recordatorio-enviado",
            usuario: QUIEN_RECUERDA,
            usuarioId: null,
            detalle: `Recordatorio a ${para}: ${v.archivos.length === 1 ? `«${v.archivos[0].nombre}» espera` : `${v.archivos.length} archivos esperan`} «${v.paso}»; el flujo venció el ${diaVisible(v.flujo.vence ?? "")}.`,
            archivoId: v.archivos.length === 1 ? v.archivos[0].id : null,
            ocurrido: momento,
          });
        }
      } catch (err) {
        fallidos++;
        const motivo = mensajeErrorCorreo(err);
        for (const v of lista) {
          lineas.push({ proyecto, flujoId: v.flujo.id, accion: "recordatorio-fallido", usuario: QUIEN_RECUERDA, usuarioId: null, detalle: `No se pudo enviar el recordatorio a ${para}: ${motivo}.`, archivoId: null, ocurrido: momento });
        }
        // A wrong key fails the same way for everyone.
        if ((err as { code?: unknown } | null)?.code === "EAUTH") detener = true;
      }
    }
    if (lineas.length) await d.store.registrarVarios(lineas);
  }
  const mensaje = `Recordatorios del ${diaVisible(hoy)}: ${enviados} enviados${fallidos ? `, ${fallidos} fallidos` : ""} en ${proyectos} ${proyectos === 1 ? "proyecto" : "proyectos"}.`;
  return { proyectos, enviados, fallidos, mensaje };
}
