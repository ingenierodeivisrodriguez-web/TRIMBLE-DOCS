/**
 * Approving and rejecting a file's step (phase 3), as pure functions:
 * - only who has the step (the person, or any member of the group: one is
 *   enough) or a project administrator decides;
 * - whoever uploaded that version never decides on it, administrators included;
 * - approving a step passes the file to the next one; approving the last one
 *   leaves it "aprobado" with that version as the approved one;
 * - rejecting needs a reason and leaves it "rechazado": its uploader corrects
 *   it and uploads a new version (phase 2 registers it as "nueva-version").
 */
import { limpiarTexto } from "./flujos";
import { ESPERANDO, meToca, responsablesArchivo, textoEstado } from "./registro";
import type { ArchivoRegistro, Asignacion, Firma, PasoFlujo } from "./types";

export interface Decisor {
  id: string;
  nombre: string;
  esAdmin: boolean;
  /** The groups (of those assigned) the caller belongs to. */
  grupos: Set<string>;
}

const nombres = (as: Asignacion[]) => as.map((r) => (r.quienTipo === "grupo" ? `${r.quienNombre} (grupo)` : r.quienNombre)).join(", ");

/** Why the caller can't decide on this file now (null: they can), and whether they would act as administrator. */
export function puedeDecidir(a: ArchivoRegistro, asignaciones: Asignacion[], quien: Decisor): { error: string | null; comoAdmin: boolean } {
  if (!ESPERANDO.includes(a.estado)) return { error: `Este archivo no espera revisión: está «${textoEstado(a)}».`, comoAdmin: false };
  const paso = a.pasos[a.pasoActual];
  if (!paso) return { error: "Este archivo no tiene un paso de revisión pendiente.", comoAdmin: false };
  if (a.subidoPorId && a.subidoPorId === quien.id) return { error: "Tú subiste esta versión: la debe revisar otra persona.", comoAdmin: false };
  const resp = responsablesArchivo(a, asignaciones);
  if (meToca(a, resp, quien.id, quien.grupos)) return { error: null, comoAdmin: false };
  if (quien.esAdmin) return { error: null, comoAdmin: true };
  return {
    error: `El paso «${paso.nombre}» de este archivo no es tuyo${resp.length ? `: lo tiene ${nombres(resp)}` : ": no tiene a nadie asignado y solo un administrador puede decidirlo"}.`,
    comoAdmin: false,
  };
}

/** The reason of a rejection or the comment of an approval, checked. */
export function revisarTexto(decision: "aprobar" | "rechazar", texto: unknown): { texto: string; error: string | null } {
  const t = typeof texto === "string" ? limpiarTexto(texto) : "";
  if (t.length > 1000) return { texto: t, error: "El texto admite hasta 1000 caracteres." };
  if (decision === "rechazar" && t.length < 3) return { texto: t, error: "Escribe el motivo del rechazo: el modelador lo necesita para corregir." };
  return { texto: t, error: null };
}

export interface PlanDecision {
  cambios: Partial<ArchivoRegistro>;
  accion: "aprobado-paso" | "aprobado" | "rechazado";
  detalle: string;
  firma: Firma;
  /** The step it passes to (approving a step that isn't the last one). */
  siguiente: PasoFlujo | null;
}

/** What a decision changes and how it reads in the history. Call `puedeDecidir` first. */
export function planDecision(a: ArchivoRegistro, decision: "aprobar" | "rechazar", quien: Decisor, comoAdmin: boolean, texto: string, momento: string): PlanDecision {
  const paso = a.pasos[a.pasoActual];
  const firma: Firma = {
    pasoId: paso.id,
    paso: paso.nombre,
    decision: decision === "aprobar" ? "aprobado" : "rechazado",
    quien: quien.nombre,
    quienId: quien.id,
    comoAdmin,
    fecha: momento,
    revision: a.revision,
    versionId: a.versionId,
    comentario: texto,
  };
  const firmas = [...a.firmas, firma];
  const admin = comoAdmin ? " (como administrador)" : "";
  const v = `la versión ${a.revision ?? "?"}`;
  if (decision === "rechazar") {
    return {
      cambios: { estado: "rechazado", firmas, actualizado: momento },
      accion: "rechazado",
      detalle: `Rechazó ${v} en «${paso.nombre}»${admin}. Motivo: ${texto}`,
      firma,
      siguiente: null,
    };
  }
  const coment = texto ? ` Comentario: ${texto}` : "";
  const siguiente = a.pasos[a.pasoActual + 1] ?? null;
  if (siguiente) {
    return {
      cambios: { pasoActual: a.pasoActual + 1, firmas, actualizado: momento },
      accion: "aprobado-paso",
      detalle: `Aprobó «${paso.nombre}» de ${v}${admin}: pasa a «${siguiente.nombre}».${coment}`,
      firma,
      siguiente,
    };
  }
  return {
    cambios: { estado: "aprobado", versionAprobadaId: a.versionId, revisionAprobada: a.revision, firmas, actualizado: momento },
    accion: "aprobado",
    detalle: `Aprobó «${paso.nombre}» de ${v}${admin}: el archivo queda aprobado.${coment}`,
    firma,
    siguiente: null,
  };
}
