/**
 * The rules of approval flows, as pure functions (the service and the screen
 * use the same ones):
 * - a flow has a title or milestone that doesn't repeat in the project, the
 *   files its creator chose (1 to MAX_ARCHIVOS) and 1 to 5 steps after
 *   "Realiza", each with its responsible (a person or a group of Trimble);
 * - since 19-11-2026 a file may be in several active flows (each one reviews
 *   it on its own); before, it was in one active flow only;
 * - a flow is closed (no editing, activating or deactivating) once every file
 *   it reviews is approved: the last decision closes it (19-11-2026; from
 *   09-11-2026 it was the first decision);
 * - since 09-11-2026 there are no review folders, no destination chosen in
 *   advance and no "who does what" by folder (the owner's decision).
 */
import { fechaHora } from "../compras/formato";
import { ArchivoFlujo, Cierre, EstadoArchivo, Flujo, MAX_ARCHIVOS, MAX_PASOS, MIN_PASOS, PasoFlujo, Responsable } from "./types";

/** The name of the first step: whoever uploads the file and corrects it if it is rejected. */
export const PAPEL_REALIZA = "realiza";

/** Spaces collapsed and trimmed. */
export function limpiarTexto(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The title as compared for repeats: lower case, without accents or double spaces. */
/** A flow's code as people see it: «FLUJO-01», «FLUJO-12», «FLUJO-105» ("" before it has one). */
export function codigoFlujo(n: number | null | undefined): string {
  return n && n > 0 ? `FLUJO-${String(n).padStart(2, "0")}` : "";
}

export function claveHito(hito: string): string {
  return limpiarTexto(hito)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** A step as the form sends it: its responsible is only a type and an id (the name comes from Trimble). */
export interface PasoEnvio {
  id?: string;
  nombre: string;
  responsable?: { tipo: "persona" | "grupo"; id: string } | null;
}

export interface DatosFlujo {
  hito: string;
  /** Trimble ids of the chosen files. */
  archivos: string[];
  pasos: PasoEnvio[];
  /** "AAAA-MM-DD" or empty. */
  vence?: string | null;
  notas?: string;
}

/** Whether "AAAA-MM-DD" is a real calendar day. */
export function esDia(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2026-11-25" → "25-11-2026". */
export const diaVisible = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

/** Why these data can't be saved as a flow, or null. */
export function revisarDatos(d: DatosFlujo): string | null {
  const hito = limpiarTexto(d.hito);
  if (hito.length < 3 || hito.length > 120) return "Escribe el título o hito del flujo (de 3 a 120 caracteres), por ejemplo «Aprobar diseño arquitectónico Torre 1».";
  if (d.archivos.length === 0) return "Marca al menos un archivo del flujo.";
  if (d.archivos.length > MAX_ARCHIVOS) return `Un flujo admite hasta ${MAX_ARCHIVOS} archivos.`;
  if (d.pasos.length < MIN_PASOS || d.pasos.length > MAX_PASOS) return `El flujo necesita de ${MIN_PASOS} a ${MAX_PASOS} pasos después de «Realiza».`;
  const vistos = new Set<string>();
  for (const [i, p] of d.pasos.entries()) {
    const nombre = limpiarTexto(p.nombre);
    if (!nombre || nombre.length > 40) return `Paso ${i + 2}: escribe su nombre (hasta 40 caracteres).`;
    const clave = claveHito(nombre);
    if (clave === PAPEL_REALIZA) return `Paso ${i + 2}: «Realiza» ya es el primer paso; usa otro nombre.`;
    if (vistos.has(clave)) return `Dos pasos se llaman «${nombre}»: usa nombres distintos.`;
    vistos.add(clave);
    if (!p.responsable?.id) return `Paso ${i + 2} («${nombre}»): elige su responsable.`;
  }
  if (d.vence && !esDia(d.vence)) return "La fecha de vencimiento no es válida.";
  if ((d.notas ?? "").length > 2000) return "La descripción admite hasta 2000 caracteres.";
  return null;
}

/** The steps with their ids: those that existed keep theirs, new ones get the next free one. Other fields pass through. */
export function idsDePasos<T extends { id?: string; nombre: string }>(pasos: T[], antes: PasoFlujo[]): (Omit<T, "id" | "nombre"> & { id: string; nombre: string })[] {
  const usados = new Set(antes.map((p) => p.id));
  let n = Math.max(0, ...antes.map((p) => Number(/^p(\d+)$/.exec(p.id)?.[1] ?? 0)));
  return pasos.map((p) => ({ ...p, id: p.id && usados.has(p.id) ? p.id : `p${++n}`, nombre: limpiarTexto(p.nombre) }));
}

/** Whether a folder or file is that folder or inside it. */
export function dentroDe(x: { id: string; ancestros: string[] }, carpetaId: string): boolean {
  return x.id === carpetaId || x.ancestros.includes(carpetaId);
}

/** "Ana Ruiz", "Arquitectura (grupo)". */
export function nombreResponsable(r: Pick<Responsable, "tipo" | "nombre">): string {
  return r.tipo === "grupo" ? `${r.nombre} (grupo)` : r.nombre;
}

/** The «Realiza» row of the panel: who created the flow, without the e-mail Trimble adds to the name ("Ana Ruiz (ana@obra.co)" → "Ana Ruiz"); "" when unknown. */
export function nombreCreador(creadoPor: string | null | undefined): string {
  const n = (creadoPor ?? "").trim();
  return n.replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim() || n;
}

/** "Realiza → Revisa → Aprueba". */
export function describirPasos(pasos: Pick<PasoFlujo, "nombre">[]): string {
  return ["Realiza", ...pasos.map((p) => p.nombre)].join(" → ");
}

/** "Revisa: Luz Gómez; Aprueba: Arquitectura (grupo)". */
export function describirResponsables(pasos: PasoFlujo[]): string {
  return pasos.map((p) => `${p.nombre}: ${p.responsable ? nombreResponsable(p.responsable) : "sin responsable"}`).join("; ");
}

/** "Obra / Diseño / modelo.rvt" → "modelo.rvt"; "Obra" → "Obra". */
export const nombreDeRuta = (ruta: string) => {
  const i = ruta.lastIndexOf(" / ");
  return i < 0 ? ruta : ruta.slice(i + 3);
};

/** What changed in a flow, in words, for the history. */
export function cambiosFlujo(antes: Pick<Flujo, "hito" | "pasos" | "archivos" | "vence" | "notas">, despues: Pick<Flujo, "hito" | "pasos" | "archivos" | "vence" | "notas">): string {
  const partes: string[] = [];
  if (antes.hito !== despues.hito) partes.push(`Hito: «${despues.hito}» (antes «${antes.hito}»).`);
  if (describirPasos(antes.pasos) !== describirPasos(despues.pasos)) partes.push(`Pasos: ${describirPasos(despues.pasos)} (antes ${describirPasos(antes.pasos)}).`);
  for (const p of despues.pasos) {
    const previo = antes.pasos.find((x) => x.id === p.id);
    if (!previo) continue;
    const ahora = p.responsable ? nombreResponsable(p.responsable) : "nadie";
    const era = previo.responsable ? nombreResponsable(previo.responsable) : "nadie";
    if (p.responsable?.tipo !== previo.responsable?.tipo || p.responsable?.id !== previo.responsable?.id) partes.push(`Responsable de «${p.nombre}»: ${ahora} (antes ${era}).`);
  }
  const nuevos = despues.pasos.filter((p) => !antes.pasos.some((x) => x.id === p.id) && p.responsable);
  if (nuevos.length) partes.push(`Responsables de los pasos nuevos: ${describirResponsables(nuevos)}.`);
  const agregados = despues.archivos.filter((a) => !antes.archivos.some((x) => x.id === a.id)).map((a) => nombreDeRuta(a.ruta));
  const quitados = antes.archivos.filter((a) => !despues.archivos.some((x) => x.id === a.id)).map((a) => nombreDeRuta(a.ruta));
  if (agregados.length) partes.push(`Archivos agregados: ${agregados.join("; ")}.`);
  if (quitados.length) partes.push(`Archivos quitados: ${quitados.join("; ")}.`);
  const v = (x: string | null | undefined) => (x ? diaVisible(x) : "sin fecha");
  if ((antes.vence ?? null) !== (despues.vence ?? null)) partes.push(`Vencimiento: ${v(despues.vence)} (antes ${v(antes.vence)}).`);
  if ((antes.notas ?? "") !== (despues.notas ?? "")) partes.push("Cambió la descripción.");
  return partes.join(" ") || "Sin cambios.";
}

/** Whether the caller may change a flow: whoever created it, or a project administrator. */
export function puedeCambiar(f: Pick<Flujo, "creadoPorId">, quien: { id: string; esAdmin: boolean }): boolean {
  return quien.esAdmin || (!!f.creadoPorId && f.creadoPorId === quien.id);
}

/** History actions that are a decision on a file («aprobado» is the last step's approval: the file is approved). */
export const ACCIONES_DECISION = ["aprobado-paso", "aprobado", "rechazado"];

/**
 * The closed flows (owner, 19-11-2026: "la última decisión es la que cierra el
 * flujo, ejemplo pepe tiene que revisar y juan tiene que aprobar entonces
 * cuando juan apruebe el flujo se cierra"): every file the flow reviews (not
 * retired) is approved at its last step. When and by whom: the flow's latest
 * approval in the history. A step approved, a rejection, or a version that
 * entered by reactivating the flow leaves it open, so its creator can still
 * edit it. From 09-11-2026 to then the first decision closed it.
 */
export function cierresFlujos(
  archivos: { flujoId: string; estado: EstadoArchivo }[],
  entradas: { flujoId?: string | null; accion: string; creado: string; usuario: string | null; id?: number }[]
): Record<string, Cierre> {
  const estados = new Map<string, EstadoArchivo[]>();
  for (const a of archivos) if (a.estado !== "retirado") estados.set(a.flujoId, [...(estados.get(a.flujoId) ?? []), a.estado]);
  const ultimas: Record<string, Cierre & { id: number }> = {};
  for (const e of entradas) {
    if (!e.flujoId || e.accion !== "aprobado") continue;
    const antes = ultimas[e.flujoId];
    const id = e.id ?? 0;
    if (!antes || e.creado > antes.fecha || (e.creado === antes.fecha && id > antes.id)) ultimas[e.flujoId] = { fecha: e.creado, quien: e.usuario ?? "", id };
  }
  const out: Record<string, Cierre> = {};
  for (const [flujoId, es] of estados) {
    if (!es.every((x) => x === "aprobado")) continue;
    const u = ultimas[flujoId];
    out[flujoId] = { fecha: u?.fecha ?? "", quien: u?.quien ?? "" };
  }
  return out;
}

/** "09-11-2026, de Jaiden Rincon": when the flow was closed and by whose decision. */
export function describirCierre(c: Cierre): string {
  return `${fechaHora(c.fecha).slice(0, 10) || "fecha sin registrar"}, de ${c.quien || "alguien"}`;
}

/** Why a closed flow can't be edited, activated or deactivated. */
export function textoCerrado(hito: string, c: Cierre): string {
  return `«${hito}» ya terminó: todos sus archivos quedaron aprobados (la última decisión el ${describirCierre(c)}). El flujo quedó cerrado y no se puede editar, activar ni desactivar. Se puede comentar, sacar el PDF y reactivarlo cuando haya una versión nueva.`;
}
