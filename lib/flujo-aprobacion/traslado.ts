/**
 * Copying the approved version to the destination folder (phase 4), as pure
 * functions:
 * - only the approved version is copied, with the same name; the first time it
 *   is version 1 in the destination, then 2, 3… (a new version of that file);
 * - the subfolders between the review folder and the file are recreated under
 *   the destination;
 * - a file with that name in the destination that the flow didn't put there (or
 *   that changed after the flow's last copy) is shown and only replaced when the
 *   approver or an administrator confirms (the owner's rule 2);
 * - only who approved the last step, or an administrator, copies or retries.
 */
import { dentroDe } from "./flujos";
import type { ArchivoRegistro, CarpetaFlujo, Flujo, Traslado } from "./types";

/** The review folder the file belongs to (the closest one of its flow). */
export function carpetaDeRevision(a: Pick<ArchivoRegistro, "fileId" | "ancestros">, flujo: Pick<Flujo, "carpetas">): CarpetaFlujo | null {
  const x = { id: a.fileId, ancestros: a.ancestros };
  return flujo.carpetas.filter((c) => dentroDe(x, c.id)).sort((p, q) => q.ancestros.length - p.ancestros.length)[0] ?? null;
}

/** The folder names between the review folder and the file ("Torre 1", "Planos"…), to recreate under the destination. */
export function subcarpetas(a: Pick<ArchivoRegistro, "ancestros" | "ruta">, carpeta: Pick<CarpetaFlujo, "id">): string[] {
  const i = a.ancestros.indexOf(carpeta.id);
  if (i < 0) return [];
  const cuantas = a.ancestros.length - i - 1;
  const partes = a.ruta.split(" / ");
  return cuantas > 0 ? partes.slice(partes.length - 1 - cuantas, partes.length - 1) : [];
}

/** Who approved the last step (the last approval signature). */
export function aprobador(a: Pick<ArchivoRegistro, "firmas">): { id: string; nombre: string } | null {
  const f = [...a.firmas].reverse().find((x) => x.decision === "aprobado");
  return f ? { id: f.quienId, nombre: f.quien } : null;
}

/**
 * Why the caller can't copy this file to the destination (null: they can).
 * What goes is the approved version, even if a newer one waits for review;
 * once a new review starts (its signatures are empty), only an administrator
 * can still copy the previously approved one.
 */
export function puedeTrasladar(a: Pick<ArchivoRegistro, "estado" | "versionAprobadaId" | "firmas">, quien: { id: string; esAdmin: boolean }): string | null {
  if (!a.versionAprobadaId || a.estado === "retirado") return "Solo se traslada una versión aprobada de un archivo que sigue en la carpeta de revisión.";
  if (quien.esAdmin) return null;
  const quienAprobo = aprobador(a);
  if (quienAprobo?.id === quien.id) return null;
  return `Solo quien lo aprobó${quienAprobo ? ` (${quienAprobo.nombre})` : ""} o un administrador puede trasladarlo.`;
}

/**
 * What the destination has under the file's name: nothing ("nuevo"), the
 * flow's last copy or the version the person confirmed to replace
 * ("version-nueva": a new version on top), or something else ("diferencia").
 */
export function situacionDestino(traslado: Pick<Traslado, "destinoVersionId"> | null, enDestino: { versionId: string | null } | null, reemplazar: string | null): "nuevo" | "version-nueva" | "diferencia" {
  if (!enDestino) return "nuevo";
  if (enDestino.versionId && (enDestino.versionId === traslado?.destinoVersionId || enDestino.versionId === reemplazar)) return "version-nueva";
  return "diferencia";
}

/** The transfer record before anything is done, keeping what the flow copied before. */
export function trasladoInicial(a: Pick<ArchivoRegistro, "versionAprobadaId" | "revisionAprobada" | "traslado">): Traslado {
  const antes = a.traslado;
  return {
    estado: "pendiente",
    mensaje: "",
    versionId: a.versionAprobadaId,
    revision: a.revisionAprobada,
    carpetaId: antes?.carpetaId ?? null,
    carpetaRuta: antes?.carpetaRuta ?? "",
    uploadId: null,
    destinoFileId: antes?.destinoFileId ?? null,
    destinoVersionId: antes?.destinoVersionId ?? null,
    destinoRevision: antes?.destinoRevision ?? null,
    por: antes?.por ?? null,
    porId: antes?.porId ?? null,
    fecha: antes?.fecha ?? null,
    diferenciaVersionId: null,
    diferenciaTexto: "",
  };
}

/** "En destino: versión 2 (04-11-2026 18:20, Luz)", "Traslado en curso…" and the like. */
export function textoTraslado(t: Traslado | null, fecha: (iso: string) => string): string {
  if (!t) return "";
  switch (t.estado) {
    case "hecho":
      return `En destino: versión ${t.destinoRevision ?? "?"}${t.fecha ? ` (${fecha(t.fecha)}${t.por ? `, ${t.por}` : ""})` : ""}`;
    case "en-curso":
      return "Copia al destino en curso…";
    case "diferencia":
      return "En destino hay otro archivo con ese nombre";
    case "error":
      return "No se pudo copiar al destino";
    default:
      return "Copia al destino pendiente";
  }
}
