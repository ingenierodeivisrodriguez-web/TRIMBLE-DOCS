/**
 * The rules of approval flows, as pure functions (the service and the screen
 * use the same ones):
 * - a flow has a title or milestone that doesn't repeat in the project, one or
 *   more review folders, a destination folder and 1 to 5 steps after "Realiza";
 * - a folder is a review folder of one active flow only; in nested folders the
 *   closest flow wins;
 * - a destination folder and a review folder are never one inside the other
 *   (what is approved would be detected again as a file to review);
 * - who does what is assigned on folders or files: a file's own assignment
 *   wins over its folder's, and the closest folder over the ones above.
 */
import { Asignacion, CarpetaFlujo, Flujo, MAX_CARPETAS, MAX_PASOS, MIN_PASOS, PasoFlujo } from "./types";

export const PAPEL_REALIZA = "realiza";
export const PAPEL_CONSULTA = "consulta";

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

export interface DatosFlujo {
  hito: string;
  carpetas: string[];
  destino: string;
  pasos: { id?: string; nombre: string }[];
}

/** Why these data can't be saved as a flow, or null. */
export function revisarDatos(d: DatosFlujo): string | null {
  const hito = limpiarTexto(d.hito);
  if (hito.length < 3 || hito.length > 120) return "Escribe el título o hito del flujo (de 3 a 120 caracteres), por ejemplo «Aprobar diseño arquitectónico Torre 1».";
  if (d.carpetas.length === 0) return "Elige al menos una carpeta de revisión.";
  if (d.carpetas.length > MAX_CARPETAS) return `Un flujo admite hasta ${MAX_CARPETAS} carpetas de revisión.`;
  if (!d.destino) return "Elige la carpeta destino.";
  if (d.carpetas.includes(d.destino)) return "La carpeta destino no puede ser también una carpeta de revisión.";
  if (d.pasos.length < MIN_PASOS || d.pasos.length > MAX_PASOS) return `El flujo necesita de ${MIN_PASOS} a ${MAX_PASOS} pasos después de «Realiza».`;
  const vistos = new Set<string>();
  for (const [i, p] of d.pasos.entries()) {
    const nombre = limpiarTexto(p.nombre);
    if (!nombre || nombre.length > 40) return `Paso ${i + 2}: escribe su nombre (hasta 40 caracteres).`;
    const clave = claveHito(nombre);
    if (clave === PAPEL_REALIZA || clave === PAPEL_CONSULTA) return `Paso ${i + 2}: «Realiza» y «Consulta» ya existen; usa otro nombre.`;
    if (vistos.has(clave)) return `Dos pasos se llaman «${nombre}»: usa nombres distintos.`;
    vistos.add(clave);
  }
  return null;
}

/** The steps with their ids: those that existed keep theirs, new ones get the next free one. */
export function idsDePasos(pasos: { id?: string; nombre: string }[], antes: PasoFlujo[]): PasoFlujo[] {
  const usados = new Set(antes.map((p) => p.id));
  let n = Math.max(0, ...antes.map((p) => Number(/^p(\d+)$/.exec(p.id)?.[1] ?? 0)));
  return pasos.map((p) => ({ id: p.id && usados.has(p.id) ? p.id : `p${++n}`, nombre: limpiarTexto(p.nombre) }));
}

/** Whether a folder or file is that folder or inside it. */
export function dentroDe(x: { id: string; ancestros: string[] }, carpetaId: string): boolean {
  return x.id === carpetaId || x.ancestros.includes(carpetaId);
}

/**
 * What breaks the rules between this flow and the other active ones of the
 * project (one active flow per review folder; destinations and review folders
 * never one inside the other), in words; empty when nothing does.
 */
export function conflictos(nuevo: { id?: string; carpetas: CarpetaFlujo[]; destino: CarpetaFlujo }, flujos: Flujo[]): string[] {
  const otros = flujos.filter((f) => f.activo && f.id !== nuevo.id);
  const avisos = new Set<string>();
  for (const c of nuevo.carpetas) {
    const otro = otros.find((f) => f.carpetas.some((x) => x.id === c.id));
    if (otro) avisos.add(`«${c.ruta}» ya es carpeta de revisión del flujo «${otro.hito}»: una carpeta solo puede estar en un flujo activo.`);
  }
  const revisiones = [...nuevo.carpetas.map((c) => ({ c, de: "de este flujo" })), ...otros.flatMap((f) => f.carpetas.map((c) => ({ c, de: `del flujo «${f.hito}»` })))];
  const destinos = [{ c: nuevo.destino, de: "de este flujo" }, ...otros.map((f) => ({ c: f.destino, de: `del flujo «${f.hito}»` }))];
  const propias = new Set([nuevo.destino.id, ...nuevo.carpetas.map((c) => c.id)]);
  for (const d of destinos) {
    for (const r of revisiones) {
      // Only pairs that involve this flow; the others were checked when they were saved.
      if (!propias.has(d.c.id) && !propias.has(r.c.id)) continue;
      if (dentroDe(d.c, r.c.id)) avisos.add(`La carpeta destino «${d.c.ruta}» ${d.de} está dentro de «${r.c.ruta}», carpeta de revisión ${r.de}: lo aprobado se volvería a revisar.`);
      else if (dentroDe(r.c, d.c.id)) avisos.add(`La carpeta de revisión «${r.c.ruta}» ${r.de} está dentro de «${d.c.ruta}», carpeta destino ${d.de}: lo aprobado se volvería a revisar.`);
    }
  }
  return [...avisos];
}

/** The active flow of a file or folder: the one whose review folder is closest above it (or is it). */
export function flujoDe(x: { id: string; ancestros: string[] }, flujos: Flujo[]): { flujo: Flujo; carpeta: CarpetaFlujo } | null {
  let mejor: { flujo: Flujo; carpeta: CarpetaFlujo } | null = null;
  for (const flujo of flujos) {
    if (!flujo.activo) continue;
    for (const carpeta of flujo.carpetas) {
      if (dentroDe(x, carpeta.id) && (!mejor || carpeta.ancestros.length > mejor.carpeta.ancestros.length)) mejor = { flujo, carpeta };
    }
  }
  return mejor;
}

/**
 * Who has a role on a file or folder: the active assignments for that role on
 * the closest target that has any (the file itself, then its folders upward).
 */
export function responsablesDe(x: { id: string; ancestros: string[] }, papel: string, asignaciones: Asignacion[]): Asignacion[] {
  const conPapel = asignaciones.filter((a) => a.activa && a.papel === papel);
  for (const id of [x.id, ...[...x.ancestros].reverse()]) {
    const aqui = conPapel.filter((a) => a.objetivoId === id);
    if (aqui.length) return aqui;
  }
  return [];
}

/** Review steps that nobody has on a whole review folder (there, only administrators could act). */
export function avisosCobertura(flujo: Pick<Flujo, "carpetas" | "pasos">, asignaciones: Asignacion[]): string[] {
  const avisos: string[] = [];
  for (const c of flujo.carpetas) {
    const sinNadie = flujo.pasos.filter((p) => responsablesDe(c, p.id, asignaciones).length === 0).map((p) => `«${p.nombre}»`);
    if (sinNadie.length) {
      avisos.push(`En «${c.ruta}» nadie tiene ${sinNadie.length === 1 ? "el paso" : "los pasos"} ${sinNadie.join(", ")}: donde no haya a quién asignado, solo los administradores podrán hacerlo.`);
    }
  }
  return avisos;
}

/** Assignments a change of the flow leaves without sense: of a removed step, or on something no longer under any review folder. */
export function asignacionesAfectadas(asignaciones: Asignacion[], pasos: PasoFlujo[], carpetas: CarpetaFlujo[]): Asignacion[] {
  return asignaciones.filter((a) => {
    if (!a.activa) return false;
    const pasoQuitado = a.papel !== PAPEL_REALIZA && a.papel !== PAPEL_CONSULTA && !pasos.some((p) => p.id === a.papel);
    const fuera = !carpetas.some((c) => dentroDe({ id: a.objetivoId, ancestros: a.objetivoAncestros }, c.id));
    return pasoQuitado || fuera;
  });
}

/** "Realiza", "Consulta" or the step's name. */
export function nombrePapel(papel: string, pasos: PasoFlujo[]): string {
  if (papel === PAPEL_REALIZA) return "Realiza";
  if (papel === PAPEL_CONSULTA) return "Consulta";
  return pasos.find((p) => p.id === papel)?.nombre ?? "(paso quitado)";
}

/** "Realiza → Revisa → Aprueba". */
export function describirPasos(pasos: PasoFlujo[]): string {
  return ["Realiza", ...pasos.map((p) => p.nombre)].join(" → ");
}

/** What changed in a flow, in words, for the history. */
export function cambiosFlujo(antes: Pick<Flujo, "hito" | "pasos" | "carpetas" | "destino">, despues: Pick<Flujo, "hito" | "pasos" | "carpetas" | "destino">): string {
  const partes: string[] = [];
  if (antes.hito !== despues.hito) partes.push(`Hito: «${despues.hito}» (antes «${antes.hito}»).`);
  if (describirPasos(antes.pasos) !== describirPasos(despues.pasos)) partes.push(`Pasos: ${describirPasos(despues.pasos)} (antes ${describirPasos(antes.pasos)}).`);
  const agregadas = despues.carpetas.filter((c) => !antes.carpetas.some((x) => x.id === c.id)).map((c) => c.ruta);
  const quitadas = antes.carpetas.filter((c) => !despues.carpetas.some((x) => x.id === c.id)).map((c) => c.ruta);
  if (agregadas.length) partes.push(`Carpetas de revisión agregadas: ${agregadas.join("; ")}.`);
  if (quitadas.length) partes.push(`Carpetas de revisión quitadas: ${quitadas.join("; ")}.`);
  if (antes.destino.id !== despues.destino.id) partes.push(`Carpeta destino: ${despues.destino.ruta} (antes ${antes.destino.ruta}).`);
  return partes.join(" ") || "Sin cambios.";
}
