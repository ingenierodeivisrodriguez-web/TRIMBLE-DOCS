/**
 * Registering the files of a flow (phase 2), as pure functions: what was
 * read in Trimble against what was registered.
 * - A file seen for the first time: "pendiente", with a copy of the flow's
 *   steps (a later change of the flow doesn't touch files already in process).
 * - Since 10-11-2026 a flow keeps the version it was given (the one Trimble
 *   had when the file was chosen): a newer version doesn't replace it nor start
 *   a new review; it is only noted ("version-nueva-vista", `versionNueva`) so
 *   whoever decides knows it exists. Before, a new version restarted the review
 *   ("version-reemplazada") or opened a new one ("nueva-version"); rows from
 *   then keep those states.
 * - A file taken out and chosen again, or coming from another flow, starts a
 *   new review with the version it has now.
 * - A registered file not seen any more is only checked (and retired) after a
 *   complete walk; nothing is ever deleted.
 * Who uploaded a version and when come from Trimble, not from when it was seen.
 */
import type { ArchivoRegistro, ArchivoVisto, EstadoArchivo, Flujo, Responsable, VersionNueva } from "./types";

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

/** Where the file is now (it may move while the flow keeps its version). */
function ubicacion(v: ArchivoVisto): Partial<ArchivoRegistro> {
  return { ruta: v.ruta, carpetaId: v.carpetaId, ancestros: v.ancestros };
}

/** A version Trimble has that isn't the flow's one. */
function versionNuevaDe(v: ArchivoVisto, momento: string): VersionNueva {
  return { versionId: v.versionId, revision: v.revision, nombre: v.nombre, subido: v.subido, subidoPor: v.subidoPor, subidoPorId: v.subidoPorId, visto: momento };
}

export interface Cambio {
  id: string;
  antes: ArchivoRegistro;
  cambios: Partial<ArchivoRegistro>;
  /** What goes to the history ("" when nothing does: a rename or a move inside the flow). */
  accion: "" | "version-reemplazada" | "nueva-version" | "version-nueva-vista" | "version-reactivada" | "archivo-reaparecido" | "archivo-cambio-flujo";
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
      if (r.estado === "retirado") {
        // Chosen again (or back in Trimble): a new review of the version it has now.
        plan.actualizar.push({ id: r.id, antes: r, accion: "archivo-reaparecido", cambios: { ...deTrimble(v), ...nuevoTramite, estado: r.versionAprobadaId ? "nueva-version" : "pendiente", versionNueva: null } });
      } else if ((r.versionNueva?.versionId ?? null) !== v.versionId) {
        // The flow keeps its version: the newer one is only noted (once per version).
        plan.actualizar.push({ id: r.id, antes: r, accion: "version-nueva-vista", cambios: { ...ubicacion(v), versionNueva: versionNuevaDe(v, momento), actualizado: momento } });
      } else if (r.ruta !== v.ruta) {
        plan.actualizar.push({ id: r.id, antes: r, accion: "", cambios: { ...ubicacion(v), actualizado: momento } });
      } else {
        plan.sinCambios++;
      }
      continue;
    }
    if (r.estado === "retirado") {
      plan.actualizar.push({ id: r.id, antes: r, accion: "archivo-reaparecido", cambios: { ...deTrimble(v), estado: estadoAlReaparecer(r), versionNueva: null, actualizado: momento } });
      continue;
    }
    if (r.ruta !== v.ruta || r.nombre !== v.nombre || r.versionNueva) {
      // A rename or a move; or the newer version is gone and Trimble's latest is the flow's one again.
      plan.actualizar.push({ id: r.id, antes: r, accion: "", cambios: { nombre: v.nombre, ruta: v.ruta, carpetaId: v.carpetaId, ancestros: v.ancestros, tipo: extension(v.nombre), ...(r.versionNueva ? { versionNueva: null } : {}), actualizado: momento } });
      continue;
    }
    plan.sinCambios++;
  }
  plan.faltantes = registrados.filter((r) => r.flujoId === flujo.id && r.estado !== "retirado" && !vistosIds.has(r.fileId));
  return plan;
}

/**
 * Reactivating a flow (owner, 10-11-2026: only when Trimble has newer versions
 * of its files): each file with a newer version takes it as the flow's version
 * and is reviewed again from the first step, with the flow's steps. The earlier
 * approval stays (`versionAprobadaId`) and every decision stays in the history.
 */
export function planReactivar(flujo: Flujo, registrados: ArchivoRegistro[], momento: string): Cambio[] {
  return registrados
    .filter((r) => r.flujoId === flujo.id && r.estado !== "retirado" && !!r.versionNueva?.versionId && r.versionNueva.versionId !== r.versionId)
    .map((r) => {
      const v = r.versionNueva!;
      const nombre = v.nombre || r.nombre;
      return {
        id: r.id,
        antes: r,
        accion: "version-reactivada" as const,
        cambios: {
          estado: "nueva-version" as const,
          versionId: v.versionId,
          revision: v.revision,
          subido: v.subido,
          subidoPor: v.subidoPor,
          subidoPorId: v.subidoPorId,
          nombre,
          tipo: extension(nombre),
          pasos: flujo.pasos.map((p) => ({ ...p })),
          pasoActual: 0,
          firmas: [],
          versionNueva: null,
          actualizado: momento,
        },
      };
    });
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
    case "version-nueva-vista": {
      const vn = c.cambios.versionNueva;
      const otroNombre = vn && vn.nombre && vn.nombre !== c.antes.nombre ? ` («${vn.nombre}»)` : "";
      return `Subió la versión ${vn?.revision ?? "?"}${vn?.subido ? ` el ${fecha(vn.subido)}` : ""}${otroNombre}: el flujo «${hito}» sigue con la versión ${c.antes.revision ?? "?"} (la nueva no entra sola).`;
    }
    case "version-reactivada": {
      const m = c.antes.revision ?? "?";
      const antes = c.antes.estado === "aprobado" ? `la versión ${m} quedó aprobada` : c.antes.estado === "rechazado" ? `la versión ${m} quedó rechazada` : `la versión ${m} no se decidió`;
      return `Entra la versión ${n ?? "?"} (subida por ${c.cambios.subidoPor || "—"}${cuando}) al reactivar el flujo «${hito}»: se revisa desde el primer paso; ${antes}.`;
    }
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

/**
 * Whether it is the caller's turn: they are the step's responsible, or a
 * member of the responsible group. Since 09-11-2026 (the owner: "que el botón
 * decidir le salga al usuario responsable") the person named as responsible
 * decides even on a version they uploaded (it is noted in the signature); in a
 * group, another member decides on what one of them uploaded.
 */
export function meToca(a: Pick<ArchivoRegistro, "subidoPorId">, responsables: Responsable[], yo: string, misGrupos: Set<string>): boolean {
  const subio = !!a.subidoPorId && a.subidoPorId === yo;
  return responsables.some((r) => (r.tipo === "persona" ? r.id === yo : misGrupos.has(r.id) && !subio));
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
