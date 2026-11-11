/**
 * Approving and rejecting a file's step (phase 3), as pure functions:
 * - only who has the step (the person, or any member of the group: one is
 *   enough) or a project administrator decides;
 * - whoever uploaded that version doesn't decide on it (nor as administrator),
 *   unless they are the person named responsible for the step (since
 *   09-11-2026, at the owner's request): then the signature says so;
 * - approving a step passes the file to the next one; approving the last one
 *   leaves it "aprobado" with that version as the approved one;
 * - rejecting needs a reason and leaves it "rechazado": its uploader corrects
 *   it and uploads a new version (phase 2 registers it as "nueva-version").
 */
import { limpiarTexto } from "./flujos";
import { ESPERANDO, meToca, responsablesArchivo, textoEstado } from "./registro";
import { nombreResponsable } from "./flujos";
import type { ArchivoRegistro, Firma, Flujo, PasoFlujo } from "./types";

export interface Decisor {
  id: string;
  nombre: string;
  esAdmin: boolean;
  /** The groups (of the responsibles) the caller belongs to. */
  grupos: Set<string>;
}

/** Why the caller can't decide on this file now (null: they can), and whether they would act as administrator. */
export function puedeDecidir(a: ArchivoRegistro, flujo: Pick<Flujo, "pasos"> | null, quien: Decisor): { error: string | null; comoAdmin: boolean } {
  if (!ESPERANDO.includes(a.estado)) return { error: `Este archivo no espera revisión: está «${textoEstado(a)}».`, comoAdmin: false };
  const paso = a.pasos[a.pasoActual];
  if (!paso) return { error: "Este archivo no tiene un paso de revisión pendiente.", comoAdmin: false };
  const resp = responsablesArchivo(a, flujo);
  if (meToca(a, resp, quien.id, quien.grupos)) return { error: null, comoAdmin: false };
  if (a.subidoPorId && a.subidoPorId === quien.id) {
    return { error: `Tú subiste esta versión: la decide ${resp.length ? resp.map(nombreResponsable).join(", ") : "otra persona"}${resp.some((r) => r.tipo === "grupo") ? " (otra persona del grupo)" : ""}.`, comoAdmin: false };
  }
  // Since 11-11-2026 only the step's responsible decides, administrators included (the owner's
  // wish). An administrator decides only a step that has no responsible (older flows), so no file is stuck.
  if (quien.esAdmin && !resp.length) return { error: null, comoAdmin: true };
  return {
    error: resp.length
      ? `El paso «${paso.nombre}» de este archivo no es tuyo: lo decide ${resp.map(nombreResponsable).join(", ")}, su responsable${quien.esAdmin ? " (los administradores no deciden por el responsable)" : ""}.`
      : `El paso «${paso.nombre}» de este archivo no tiene responsable: solo un administrador puede decidirlo.`,
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
    ...(a.subidoPorId && a.subidoPorId === quien.id ? { propia: true } : {}),
    fecha: momento,
    revision: a.revision,
    versionId: a.versionId,
    comentario: texto,
  };
  const firmas = [...a.firmas, firma];
  const admin = `${comoAdmin ? " (como administrador)" : ""}${firma.propia ? " (su propia versión, como responsable del paso)" : ""}`;
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
