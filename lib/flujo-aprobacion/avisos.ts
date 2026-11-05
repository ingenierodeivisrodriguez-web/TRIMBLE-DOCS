/**
 * Notices through Trimble's own ToDos (phase 3; the format was confirmed in
 * the phase 0 test: `label` + `assignees: [{ id, type }]`, and Trimble e-mails
 * the person). One ToDo per group of files that wait for the same people on
 * the same step, so a first review of a full folder doesn't flood anyone; the
 * links go in the description (attaching the file was refused by Trimble).
 * A ToDo for a group that Trimble refuses is sent again to its members.
 */
import type { Respuesta } from "../compras/cde";
import { corto } from "./prueba";
import { responsablesArchivo } from "./registro";
import type { ArchivoRegistro, Asignacion, Aviso, Firma } from "./types";

/** Files listed with their link in one ToDo; the rest are counted. */
export const MAX_EN_AVISO = 15;

const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One ToDo per (flow, step, same people) for the files that now wait for someone. */
export function avisosRevision(archivos: ArchivoRegistro[], asignaciones: Asignacion[], hitos: Map<string, string>, enlace: (a: ArchivoRegistro) => string): Aviso[] {
  const grupos = new Map<string, { archivos: ArchivoRegistro[]; para: Aviso["para"] }>();
  for (const a of archivos) {
    const resp = responsablesArchivo(a, asignaciones);
    if (!resp.length) continue;
    const para = [...new Map(resp.map((r) => [`${r.quienTipo}:${r.quienId}`, { tipo: r.quienTipo, id: r.quienId, nombre: r.quienNombre }])).values()];
    const clave = `${a.flujoId}|${a.pasos[a.pasoActual]?.id}|${para.map((p) => `${p.tipo}:${p.id}`).sort().join(",")}`;
    const g = grupos.get(clave) ?? { archivos: [], para };
    g.archivos.push(a);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(({ archivos: as, para }) => {
    const a = as[0];
    const hito = hitos.get(a.flujoId) ?? "";
    const paso = a.pasos[a.pasoActual]?.nombre ?? "";
    const lineas = as.slice(0, MAX_EN_AVISO).map((x) => `• ${x.nombre} — versión ${x.revision ?? "?"}${x.estado === "nueva-version" ? " (versión nueva)" : ""}: ${enlace(x)}`);
    const mas = as.length > MAX_EN_AVISO ? [`… y ${as.length - MAX_EN_AVISO} más: ábrelos en Flujo de aprobación → Por revisar.`] : [];
    return {
      titulo: recorte(as.length === 1 ? `Revisar: ${a.nombre} (${paso}) — ${hito}` : `Revisar ${as.length} archivos (${paso}) — ${hito}`, 120),
      descripcion: recorte(
        [`Flujo de aprobación «${hito}»: te toca el paso «${paso}».`, ...lineas, ...mas, "Apruébalos o recházalos en la extensión Flujo de aprobación, pestaña «Por revisar»."].join("\n"),
        3000
      ),
      para,
      archivos: as.map((x) => x.id),
    };
  });
}

/** The ToDo to the uploader of a rejected version, with the reason (null when Trimble didn't say who uploaded it). */
export function avisoRechazo(a: ArchivoRegistro, firma: Firma, hito: string, enlace: string): Aviso | null {
  if (!a.subidoPorId) return null;
  const carpeta = a.ruta.slice(0, Math.max(0, a.ruta.length - a.nombre.length - 3));
  return {
    titulo: recorte(`Corregir: ${a.nombre} (rechazado) — ${hito}`, 120),
    descripcion: recorte(
      [
        `${firma.quien} rechazó la versión ${firma.revision ?? "?"} en «${firma.paso}» del flujo «${hito}».`,
        `Motivo: ${firma.comentario}`,
        `Corrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta (${carpeta}).`,
        `Abrir: ${enlace}`,
      ].join("\n"),
      3000
    ),
    para: [{ tipo: "persona", id: a.subidoPorId, nombre: a.subidoPor }],
    archivos: [a.id],
  };
}

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;

/** Creates the ToDo in Trimble; a group Trimble refuses is replaced by its members. Never throws. */
export async function enviarAviso(
  crear: (cuerpo: Record<string, unknown>) => Promise<Respuesta>,
  projectId: string,
  aviso: Aviso,
  miembros: (groupId: string) => Promise<{ id: string }[]>
): Promise<{ ok: boolean; todoId: string | null; mensaje: string }> {
  const cuerpo = (assignees: { id: string; type: string }[]) => ({ projectId, label: aviso.titulo, description: aviso.descripcion, assignees });
  const quienes = aviso.para.map((p) => p.nombre + (p.tipo === "grupo" ? " (grupo)" : "")).join(", ");
  try {
    const r = await crear(cuerpo(aviso.para.map((p) => ({ id: p.id, type: p.tipo === "grupo" ? "GROUP" : "USER" }))));
    const id = (respuesta: unknown) => {
      const v = (respuesta as { id?: unknown } | null)?.id;
      return typeof v === "string" ? v : null;
    };
    if (ok(r)) return { ok: true, todoId: id(r.cuerpo), mensaje: `Tarea de Trimble para ${quienes}: «${aviso.titulo}».` };
    if (!aviso.para.some((p) => p.tipo === "grupo") || r.estado === 401 || r.estado === 403) {
      return { ok: false, todoId: null, mensaje: `Trimble no creó la tarea para ${quienes} (${r.estado}): ${corto(r)}` };
    }
    const personas = new Set(aviso.para.filter((p) => p.tipo === "persona").map((p) => p.id));
    for (const g of aviso.para.filter((p) => p.tipo === "grupo")) for (const m of await miembros(g.id)) personas.add(m.id);
    if (!personas.size) return { ok: false, todoId: null, mensaje: `Trimble no aceptó la tarea para el grupo y el grupo no tiene miembros: no se avisó a ${quienes}.` };
    const otra = await crear(cuerpo([...personas].map((id) => ({ id, type: "USER" }))));
    if (ok(otra)) return { ok: true, todoId: id(otra.cuerpo), mensaje: `Tarea de Trimble para ${quienes} (a cada miembro del grupo): «${aviso.titulo}».` };
    return { ok: false, todoId: null, mensaje: `Trimble no creó la tarea para ${quienes} (${otra.estado}): ${corto(otra)}` };
  } catch (err) {
    return { ok: false, todoId: null, mensaje: `No se pudo crear la tarea para ${quienes}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
