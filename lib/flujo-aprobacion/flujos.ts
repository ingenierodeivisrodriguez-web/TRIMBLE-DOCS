/**
 * The rules of approval flows, as pure functions (the service and the screen
 * use the same ones):
 * - a flow has a title or milestone that doesn't repeat in the project, the
 *   files its creator chose (1 to MAX_ARCHIVOS) and 1 to 5 steps after
 *   "Realiza", each with its responsible (a person or a group of Trimble);
 * - a file is in one active flow only (otherwise, which approval counts?);
 * - since 09-11-2026 there are no review folders, no destination chosen in
 *   advance and no "who does what" by folder (the owner's decision).
 */
import { fechaHora } from "../compras/formato";
import { ArchivoFlujo, Cierre, Flujo, MAX_ARCHIVOS, MAX_PASOS, MIN_PASOS, PasoFlujo, Responsable } from "./types";

/** The name of the first step: whoever uploads the file and corrects it if it is rejected. */
export const PAPEL_REALIZA = "realiza";

/** Spaces collapsed and trimmed. */
export function limpiarTexto(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The title as compared for repeats: lower case, without accents or double spaces. */
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
  if ((d.notas ?? "").length > 2000) return "Las notas admiten hasta 2000 caracteres.";
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

/** The chosen files that already are in another active flow, in words; empty when none is. */
export function conflictosArchivos(nuevo: { id?: string; archivos: ArchivoFlujo[] }, flujos: Flujo[]): string[] {
  const otros = flujos.filter((f) => f.activo && f.id !== nuevo.id);
  const avisos: string[] = [];
  for (const a of nuevo.archivos) {
    const otro = otros.find((f) => f.archivos.some((x) => x.id === a.id));
    if (otro) avisos.push(`«${a.ruta}» ya está en el flujo activo «${otro.hito}»: un archivo solo puede estar en un flujo activo.`);
  }
  return avisos;
}

/** "Ana Ruiz", "Arquitectura (grupo)". */
export function nombreResponsable(r: Pick<Responsable, "tipo" | "nombre">): string {
  return r.tipo === "grupo" ? `${r.nombre} (grupo)` : r.nombre;
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
  if ((antes.notas ?? "") !== (despues.notas ?? "")) partes.push("Cambió las notas.");
  return partes.join(" ") || "Sin cambios.";
}

/** Whether the caller may change a flow: whoever created it, or a project administrator. */
export function puedeCambiar(f: Pick<Flujo, "creadoPorId">, quien: { id: string; esAdmin: boolean }): boolean {
  return quien.esAdmin || (!!f.creadoPorId && f.creadoPorId === quien.id);
}

/** History actions that are a decision on a file: the first one closes the flow (09-11-2026). */
export const ACCIONES_DECISION = ["aprobado-paso", "aprobado", "rechazado"];

/** The first decision of each flow, from history lines in any order. */
export function primerasDecisiones(entradas: { flujoId?: string | null; accion: string; creado: string; usuario: string | null; id?: number }[]): Record<string, Cierre> {
  const out: Record<string, Cierre & { id: number }> = {};
  for (const e of entradas) {
    if (!e.flujoId || !ACCIONES_DECISION.includes(e.accion)) continue;
    const antes = out[e.flujoId];
    const id = e.id ?? 0;
    if (!antes || e.creado < antes.fecha || (e.creado === antes.fecha && id < antes.id)) out[e.flujoId] = { fecha: e.creado, quien: e.usuario ?? "", id };
  }
  return Object.fromEntries(Object.entries(out).map(([k, { fecha, quien }]) => [k, { fecha, quien }]));
}

/** "09-11-2026, de Jaiden Rincon": when the flow was closed and by whose decision. */
export function describirCierre(c: Cierre): string {
  return `${fechaHora(c.fecha).slice(0, 10) || "fecha sin registrar"}, de ${c.quien || "alguien"}`;
}

/** Why a closed flow can't be edited, activated or deactivated. */
export function textoCerrado(hito: string, c: Cierre): string {
  return `«${hito}» ya tiene decisiones (la primera el ${describirCierre(c)}): el flujo quedó cerrado y no se puede editar, activar ni desactivar. Se puede seguir decidiendo, comentando y sacando el PDF.`;
}
