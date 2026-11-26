/**
 * The notices of a flow, as pure functions: who a step now waits for, and who
 * must correct a rejected version, with what their e-mail says. Since
 * 19-11-2026 (the owner: "elimina totalmente la creación de tareas en trimble
 * al crear y cerrar flujos") they go only as the extension's own e-mail: no
 * Trimble ToDo is created or closed any more (until then there was one per
 * notice, and it was closed when its files no longer waited). One notice per
 * group of files that wait for the same people on the same step, so
 * registering many files at once doesn't flood anyone.
 */
import { codigoFlujo } from "./flujos";
import { responsablesArchivo } from "./registro";
import type { DatosCorreo } from "./correo";
import type { ArchivoRegistro, Aviso, Firma, Flujo } from "./types";

const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a notice needs from its flow. */
export type FlujoAviso = Pick<Flujo, "hito" | "pasos"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>;

/** One notice per (step, same people) for the files of a flow that now wait for someone. */
export function avisosRevision(archivos: ArchivoRegistro[], flujo: FlujoAviso, enlace: (a: ArchivoRegistro) => string): Aviso[] {
  const grupos = new Map<string, { archivos: ArchivoRegistro[]; para: Aviso["para"] }>();
  for (const a of archivos) {
    const resp = responsablesArchivo(a, flujo);
    if (!resp.length) continue;
    const para = [...new Map(resp.map((r) => [`${r.tipo}:${r.id}`, { tipo: r.tipo, id: r.id, nombre: r.nombre }])).values()];
    const clave = `${a.flujoId}|${a.pasos[a.pasoActual]?.id}|${para.map((p) => `${p.tipo}:${p.id}`).sort().join(",")}`;
    const g = grupos.get(clave) ?? { archivos: [], para };
    g.archivos.push(a);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(({ archivos: as, para }) => {
    const a = as[0];
    const hito = flujo.hito;
    const paso = a.pasos[a.pasoActual]?.nombre ?? "";
    return {
      titulo: recorte(as.length === 1 ? `Revisar: ${a.nombre} (${paso}) — ${hito}` : `Revisar ${as.length} archivos (${paso}) — ${hito}`, 120),
      para,
      archivos: as.map((x) => x.id),
      tipo: "revision" as const,
      pasoId: a.pasos[a.pasoActual]?.id ?? null,
      correo: {
        tipo: "revision",
        codigo: codigoFlujo(flujo.codigo),
        hito,
        notas: flujo.notas ?? "",
        vence: flujo.vence ?? null,
        paso,
        archivos: as.map((x) => ({ nombre: x.nombre, revision: x.revision ?? null, enlace: enlace(x), nueva: x.estado === "nueva-version" })),
        mas: 0,
      } satisfies DatosCorreo,
    };
  });
}

/** The notice to the uploader of a rejected version, with the reason (null when Trimble didn't say who uploaded it). */
export function avisoRechazo(a: ArchivoRegistro, firma: Firma, flujo: Pick<Flujo, "hito"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>, enlace: string): Aviso | null {
  if (!a.subidoPorId) return null;
  const hito = flujo.hito;
  const carpeta = a.ruta.slice(0, Math.max(0, a.ruta.length - a.nombre.length - 3));
  return {
    titulo: recorte(`Corregir: ${a.nombre} (rechazado) — ${hito}`, 120),
    para: [{ tipo: "persona", id: a.subidoPorId, nombre: a.subidoPor }],
    archivos: [a.id],
    tipo: "correccion",
    pasoId: null,
    correo: {
      tipo: "correccion",
      codigo: codigoFlujo(flujo.codigo),
      hito,
      notas: flujo.notas ?? "",
      vence: flujo.vence ?? null,
      paso: firma.paso,
      archivos: [{ nombre: a.nombre, revision: firma.revision ?? a.revision ?? null, enlace, nueva: false }],
      mas: 0,
      rechazo: { quien: firma.quien, motivo: firma.comentario, carpeta },
    },
  };
}

/**
 * Versions rejected together (several files chosen in the panel, 26-11-2026):
 * one notice per uploader with all their files and the reason, instead of one
 * e-mail per file. `sinQuien`: files Trimble didn't say who uploaded.
 */
export function avisosRechazo(
  items: { a: ArchivoRegistro; firma: Firma }[],
  flujo: Pick<Flujo, "hito"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>,
  enlace: (a: ArchivoRegistro) => string
): { avisos: Aviso[]; sinQuien: number } {
  const porQuien = new Map<string, { a: ArchivoRegistro; firma: Firma }[]>();
  let sinQuien = 0;
  for (const it of items) {
    if (!it.a.subidoPorId) {
      sinQuien++;
      continue;
    }
    porQuien.set(it.a.subidoPorId, [...(porQuien.get(it.a.subidoPorId) ?? []), it]);
  }
  const avisos = [...porQuien.values()].map((grupo) => {
    const { a, firma } = grupo[0];
    const uno = avisoRechazo(a, firma, flujo, enlace(a))!;
    if (grupo.length === 1 || !uno.correo) return uno;
    const carpetas = [...new Set(grupo.map((x) => x.a.ruta.slice(0, Math.max(0, x.a.ruta.length - x.a.nombre.length - 3))))];
    const pasos = [...new Set(grupo.map((x) => x.firma.paso))];
    return {
      ...uno,
      titulo: recorte(`Corregir ${grupo.length} archivos (rechazados) — ${flujo.hito}`, 120),
      archivos: grupo.map((x) => x.a.id),
      correo: {
        ...uno.correo,
        paso: pasos.join(" / "),
        archivos: grupo.map((x) => ({ nombre: x.a.nombre, revision: x.firma.revision ?? x.a.revision ?? null, enlace: enlace(x.a), nueva: false })),
        rechazo: { quien: firma.quien, motivo: firma.comentario, carpeta: carpetas.length === 1 ? carpetas[0] : "cada uno en la suya" },
      },
    };
  });
  return { avisos, sinQuien };
}
