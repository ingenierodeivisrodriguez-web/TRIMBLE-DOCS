/**
 * Traceability (phase 5), as pure functions: for each registered file, what
 * happened to it in order (who uploaded each version and when, who reviewed,
 * the decision and its date, comments and reasons, notices, who copied it to
 * the destination and when), from the history that is never edited. Filters by
 * flow, state, dates (Colombian calendar days) and text, for the screen and
 * for the PDF.
 */
import { fechaHora } from "../compras/formato";
import { textoEstado } from "./registro";
import { textoTraslado } from "./traslado";
import type { ArchivoRegistro, EntradaHistorial, EstadoArchivo } from "./types";

/** What each history line means, in words (also used by the History tab). */
export const ACCIONES: Record<string, string> = {
  "flujo-creado": "Creó el flujo",
  "flujo-modificado": "Cambió el flujo",
  "flujo-desactivado": "Desactivó el flujo",
  "flujo-activado": "Activó el flujo",
  "asignacion-agregada": "Asignó",
  "asignacion-quitada": "Quitó una asignación",
  "archivo-detectado": "Subió un archivo",
  "version-reemplazada": "Subió otra versión",
  "nueva-version": "Subió una versión nueva",
  "version-nueva-vista": "Subió una versión nueva (el flujo sigue con la suya)",
  "archivo-retirado": "Archivo retirado",
  "archivo-reaparecido": "Archivo que vuelve",
  "archivo-cambio-flujo": "Archivo que cambió de flujo",
  "aprobado-paso": "Aprobó un paso",
  aprobado: "Aprobó",
  rechazado: "Rechazó",
  "aviso-enviado": "Avisó (tarea de Trimble)",
  "aviso-fallido": "Aviso no enviado",
  trasladado: "Trasladó al destino",
  "traslado-diferencia": "Traslado en espera",
  "traslado-error": "Traslado fallido",
};

export interface FiltroTraza {
  flujoId?: string;
  estado?: EstadoArchivo | "";
  /** Calendar days "AAAA-MM-DD" (Colombia), both included. */
  desde?: string;
  hasta?: string;
  /** Part of the name or the folder. */
  texto?: string;
}

export interface EventoTraza {
  fecha: string;
  quien: string;
  que: string;
  accion: string;
  version: number | null;
  detalle: string;
}

export interface Traza {
  archivo: ArchivoRegistro & { hito: string };
  /** In order of when it happened (Trimble's date for uploads). */
  eventos: EventoTraza[];
}

const cuando = (e: Pick<EntradaHistorial, "ocurrido" | "creado">) => e.ocurrido ?? e.creado;

/** "2026-11-04" for a moment, by the Colombian calendar. */
export function diaColombia(iso: string): string {
  const f = fechaHora(iso);
  return f ? `${f.slice(6, 10)}-${f.slice(3, 5)}-${f.slice(0, 2)}` : "";
}

/** The files that match the filter, each with its events (only those within the dates, when dates are given). */
export function armarTrazas(archivos: ArchivoRegistro[], entradas: EntradaHistorial[], hitos: Map<string, string>, filtro: FiltroTraza = {}): Traza[] {
  const texto = (filtro.texto ?? "").trim().toLowerCase();
  const porArchivo = new Map<string, EntradaHistorial[]>();
  for (const e of entradas) {
    if (!e.archivoId) continue;
    const lista = porArchivo.get(e.archivoId) ?? [];
    lista.push(e);
    porArchivo.set(e.archivoId, lista);
  }
  const conFechas = !!(filtro.desde || filtro.hasta);
  const enRango = (e: EntradaHistorial) => {
    const d = diaColombia(cuando(e));
    return (!filtro.desde || d >= filtro.desde) && (!filtro.hasta || d <= filtro.hasta);
  };
  const porRuta = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  return archivos
    .filter((a) => (!filtro.flujoId || a.flujoId === filtro.flujoId) && (!filtro.estado || a.estado === filtro.estado) && (!texto || a.ruta.toLowerCase().includes(texto)))
    .map((a) => {
      const eventos = (porArchivo.get(a.id) ?? [])
        .filter((e) => !conFechas || enRango(e))
        .sort((x, y) => cuando(x).localeCompare(cuando(y)) || x.id - y.id)
        .map((e) => ({ fecha: cuando(e), quien: e.usuario ?? "", que: ACCIONES[e.accion] ?? e.accion, accion: e.accion, version: e.version ?? null, detalle: e.detalle }));
      return { archivo: { ...a, hito: hitos.get(a.flujoId) ?? "" }, eventos };
    })
    .filter((t) => !conFechas || t.eventos.length > 0)
    .sort((x, y) => porRuta.compare(x.archivo.hito, y.archivo.hito) || porRuta.compare(x.archivo.ruta, y.archivo.ruta));
}

/** The lines that sum a file up at the top of its section. */
export function resumenTraza(t: Traza): { etiqueta: string; valor: string }[] {
  const a = t.archivo;
  const subidas = t.eventos.filter((e) => ["archivo-detectado", "version-reemplazada", "nueva-version", "version-nueva-vista"].includes(e.accion));
  const decisiones = t.eventos.filter((e) => ["aprobado-paso", "aprobado", "rechazado"].includes(e.accion));
  const traslados = t.eventos.filter((e) => e.accion === "trasladado");
  const ultima = <T extends EventoTraza>(xs: T[]) => xs[xs.length - 1];
  const linea = (e: EventoTraza | undefined) => (e ? `${e.quien || "—"}, ${fechaHora(e.fecha)}${e.version ? ` (versión ${e.version})` : ""}` : "—");
  return [
    { etiqueta: "Flujo (hito)", valor: a.hito || "—" },
    { etiqueta: "Ubicación", valor: a.ruta },
    { etiqueta: "Estado", valor: `${textoEstado(a)} · versión ${a.revision ?? "?"}${a.revisionAprobada ? ` · aprobada: ${a.revisionAprobada}` : ""}` },
    { etiqueta: "Última subida", valor: linea(ultima(subidas)) },
    { etiqueta: "Última decisión", valor: ultima(decisiones) ? `${ultima(decisiones).que}: ${linea(ultima(decisiones))}` : "—" },
    { etiqueta: "Traslado", valor: a.traslado ? `${textoTraslado(a.traslado, fechaHora)}${ultima(traslados) ? ` · ${linea(ultima(traslados))}` : ""}` : "—" },
  ];
}

/** "Flujo: Aprobar Torre 1 · Estado: Aprobado · Del 01-11-2026 al 04-11-2026", for the PDF's header. */
export function describirFiltro(filtro: FiltroTraza, hitos: Map<string, string>): string {
  const d = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
  const partes = [
    filtro.flujoId ? `Flujo: ${hitos.get(filtro.flujoId) ?? "—"}` : "Todos los flujos",
    filtro.estado ? `Estado: ${textoEstado({ estado: filtro.estado, revisionAprobada: null })}` : "",
    filtro.desde && filtro.hasta ? `Del ${d(filtro.desde)} al ${d(filtro.hasta)}` : filtro.desde ? `Desde el ${d(filtro.desde)}` : filtro.hasta ? `Hasta el ${d(filtro.hasta)}` : "",
    filtro.texto?.trim() ? `Texto: «${filtro.texto.trim()}»` : "",
  ];
  return partes.filter(Boolean).join(" · ");
}
