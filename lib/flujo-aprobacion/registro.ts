/**
 * Registering the files of a flow (phase 2), as pure functions: what was
 * read in Trimble against what was registered.
 * - A file seen for the first time: "pendiente", with a copy of the flow's
 *   steps (a later change of the flow doesn't touch files already in process).
 * - A new version while it waits: the review restarts on the latest version
 *   ("version-reemplazada"); after a decision (approved or rejected) it is
 *   "nueva-version" and starts with the flow's current steps.
 * - A registered file not seen any more is only checked (and retired) after a
 *   complete walk; nothing is ever deleted.
 * Who uploaded a version and when come from Trimble, not from when it was seen.
 */
import type { ArchivoRegistro, ArchivoVisto, EstadoArchivo, Flujo, Responsable } from "./types";

/** States that wait for someone's review. */
export const ESPERANDO: EstadoArchivo[] = ["pendiente", "nueva-version"];

export function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 && i < nombre.length - 1 ? nombre.slice(i + 1).toLowerCase() : "";
}

/** The registered fields that come from Trimble's latest version. */
function deTrimble(v: ArchivoVisto): Partial<ArchivoRegistro> {
  return {
    nombre: v.nombre,
    ruta: v.ruta,
    carpetaId: v.carpetaId,
    ancestros: v.ancestros,
    tipo: extension(v.nombre),
    versionId: v.versionId,
    revision: v.revision,
    subido: v.subido,
    subidoPor: v.subidoPor,
    subidoPorId: v.subidoPorId,
  };
}

export interface Cambio {
  id: string;
  antes: ArchivoRegistro;
  cambios: Partial<ArchivoRegistro>;
  /** What goes to the history ("" when nothing does: a rename or a move inside the flow). */
  accion: "" | "version-reemplazada" | "nueva-version" | "archivo-reaparecido" | "archivo-cambio-flujo";
}

export interface PlanRegistro {
  crear: Omit<ArchivoRegistro, "id">[];
  actualizar: Cambio[];
  /** Registered files of this flow not seen in the walk: to check in Trimble before retiring them. */
  faltantes: ArchivoRegistro[];
  sinCambios: number;
}

/** The state a file goes back to when it reappears with the same version it had. */
function estadoAlReaparecer(r: ArchivoRegistro): EstadoArchivo {
  if (r.versionAprobadaId && r.versionAprobadaId === r.versionId) return "aprobado";
  return r.versionAprobadaId ? "nueva-version" : "pendiente";
}

/**
 * What to create and change after reading a flow's files.
 * `registrados`: every registered file of the project (a file may come from another flow).
 */
export function planRegistro(flujo: Flujo, registrados: ArchivoRegistro[], vistos: ArchivoVisto[], momento: string): PlanRegistro {
  const porFile = new Map(registrados.map((r) => [r.fileId, r]));
  const plan: PlanRegistro = { crear: [], actualizar: [], faltantes: [], sinCambios: 0 };
  const vistosIds = new Set<string>();
  for (const v of vistos) {
    if (vistosIds.has(v.fileId)) continue;
    vistosIds.add(v.fileId);
    const r = porFile.get(v.fileId);
    const nuevoTramite = { pasos: flujo.pasos.map((p) => ({ ...p })), pasoActual: 0, firmas: [], actualizado: momento };
    if (!r) {
      plan.crear.push({
        proyecto: flujo.proyecto,
        flujoId: flujo.id,
        fileId: v.fileId,
        nombre: v.nombre,
        ruta: v.ruta,
        carpetaId: v.carpetaId,
        ancestros: v.ancestros,
        tipo: extension(v.nombre),
        estado: "pendiente",
        pasos: nuevoTramite.pasos,
        pasoActual: 0,
        firmas: [],
        traslado: null,
        versionId: v.versionId,
        revision: v.revision,
        subido: v.subido,
        subidoPor: v.subidoPor,
        subidoPorId: v.subidoPorId,
        versionAprobadaId: null,
        revisionAprobada: null,
        detectado: momento,
        actualizado: momento,
      });
      continue;
    }
    if (r.flujoId !== flujo.id) {
      // It was in another (inactive) flow: a new review with this one.
      plan.actualizar.push({ id: r.id, antes: r, accion: "archivo-cambio-flujo", cambios: { ...deTrimble(v), ...nuevoTramite, flujoId: flujo.id, estado: "pendiente", versionAprobadaId: null, revisionAprobada: null, traslado: null } });
      continue;
    }
    if (r.versionId !== v.versionId) {
      if (r.estado === "pendiente" || r.estado === "nueva-version") {
        plan.actualizar.push({ id: r.id, antes: r, accion: "version-reemplazada", cambios: { ...deTrimble(v), pasoActual: 0, firmas: [], actualizado: momento } });
      } else if (r.estado === "retirado") {
        plan.actualizar.push({ id: r.id, antes: r, accion: "archivo-reaparecido", cambios: { ...deTrimble(v), ...nuevoTramite, estado: r.versionAprobadaId ? "nueva-version" : "pendiente" } });
      } else {
        plan.actualizar.push({ id: r.id, antes: r, accion: "nueva-version", cambios: { ...deTrimble(v), ...nuevoTramite, estado: "nueva-version" } });
      }
      continue;
    }
    if (r.estado === "retirado") {
      plan.actualizar.push({ id: r.id, antes: r, accion: "archivo-reaparecido", cambios: { ...deTrimble(v), estado: estadoAlReaparecer(r), actualizado: momento } });
      continue;
    }
    if (r.ruta !== v.ruta || r.nombre !== v.nombre) {
      plan.actualizar.push({ id: r.id, antes: r, accion: "", cambios: { nombre: v.nombre, ruta: v.ruta, carpetaId: v.carpetaId, ancestros: v.ancestros, tipo: extension(v.nombre), actualizado: momento } });
      continue;
    }
    plan.sinCambios++;
  }
  plan.faltantes = registrados.filter((r) => r.flujoId === flujo.id && r.estado !== "retirado" && !vistosIds.has(r.fileId));
  return plan;
}

/** "Ana Ruiz subió la versión 3 el 03-11-2026 14:20." and the like, for the history. */
export function detalleCambio(c: Cambio, hito: string, fecha: (iso: string) => string): string {
  // Who uploaded goes in the line's own "who" column.
  const n = c.cambios.revision ?? c.antes.revision;
  const cuando = c.cambios.subido ? ` el ${fecha(c.cambios.subido)}` : "";
  switch (c.accion) {
    case "version-reemplazada":
      return `Subió la versión ${n ?? "?"}${cuando} mientras la versión ${c.antes.revision ?? "?"} esperaba revisión: se revisa la nueva desde el primer paso.`;
    case "nueva-version":
      return `Subió la versión ${n ?? "?"}${cuando}: nueva versión pendiente de revisión${c.antes.revisionAprobada ? ` (la aprobada es la ${c.antes.revisionAprobada})` : ""}.`;
    case "archivo-reaparecido":
      return `Volvió a aparecer en ${c.cambios.ruta ?? c.antes.ruta} (versión ${n ?? "?"}).`;
    case "archivo-cambio-flujo":
      return `Se movió a ${c.cambios.ruta ?? c.antes.ruta}: ahora lo revisa el flujo «${hito}» desde el primer paso.`;
    default:
      return "";
  }
}

/**
 * Who has the step a file waits for (none when it waits for nobody): the
 * step's responsible in the flow as it is now (changing it reaches files in
 * process), else the one in the file's own copy of the steps.
 */
export function responsablesArchivo(a: Pick<ArchivoRegistro, "estado" | "pasos" | "pasoActual">, flujo: Pick<Flujo, "pasos"> | null | undefined): Responsable[] {
  if (!ESPERANDO.includes(a.estado)) return [];
  const paso = a.pasos[a.pasoActual];
  if (!paso) return [];
  const r = flujo?.pasos.find((p) => p.id === paso.id)?.responsable ?? paso.responsable;
  return r ? [r] : [];
}

/** Whether it is the caller's turn: they (or one of their groups) have the step, and they didn't upload that version. */
export function meToca(a: Pick<ArchivoRegistro, "subidoPorId">, responsables: Responsable[], yo: string, misGrupos: Set<string>): boolean {
  if (a.subidoPorId && a.subidoPorId === yo) return false;
  return responsables.some((r) => (r.tipo === "persona" ? r.id === yo : misGrupos.has(r.id)));
}

/** "Pendiente de revisión", "Nueva versión pendiente de revisión (aprobada: v5)"… */
export function textoEstado(a: Pick<ArchivoRegistro, "estado" | "revisionAprobada">): string {
  switch (a.estado) {
    case "pendiente":
      return "Pendiente de revisión";
    case "nueva-version":
      return `Nueva versión pendiente de revisión${a.revisionAprobada ? ` (aprobada: v${a.revisionAprobada})` : ""}`;
    case "aprobado":
      return "Aprobado";
    case "rechazado":
      return "Rechazado";
    default:
      return "Retirado";
  }
}
