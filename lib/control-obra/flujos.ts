import { MotivoRechazo, tiene } from "./accesos";
import {
  AccionFlujo,
  Asignacion,
  EstadoFlujo,
  FlujoDocumento,
  MAX_PASOS,
  MIN_PASOS,
  PasoFlujo,
  Permiso,
  Rol,
  TipoFlujo,
  TIPOS_FLUJO,
} from "./types";

/**
 * Configurable approval flows (per project and kind of document) and how a
 * document moves through them. The same rules run in obra_flujo_accion of
 * supabase/control-obra.sql: the app gives the clear messages, the database
 * makes sure nothing gets around them.
 *
 * - Step 0 prepares and sends; steps 1… approve, the last one for good.
 * - Returning needs a reason and goes back ONE step (to step 0: the document is
 *   "devuelto" and can be edited again).
 * - Whoever prepared the document doesn't approve it, and one person signs only
 *   one step of the same document.
 * - A document keeps the copy of the flow it was first sent with: changing the
 *   project's flow doesn't change documents already in process.
 */

export function tipoFlujo(tipo: TipoFlujo) {
  return TIPOS_FLUJO.find((t) => t.id === tipo)!;
}

/** The permission a role needs to act in step `i` of a flow of this kind. */
export function permisoDePaso(tipo: TipoFlujo, i: number): Permiso {
  const t = tipoFlujo(tipo);
  return `${t.modulo}.${i === 0 ? t.accionInicial : "aprobar"}` as Permiso;
}

/** What each step does, in words: "elabora", "preaprueba", "aprueba". */
export function papelDePaso(i: number, total: number): string {
  if (i === 0) return "elabora";
  return i === total - 1 ? "aprueba" : "preaprueba";
}

/** "Residente de obra (elabora) → Director (preaprueba) → Interventoría (aprueba)". */
export function describirFlujo(pasos: PasoFlujo[], nombreRol: (id: string) => string = () => ""): string {
  return pasos.map((p, i) => `${p.rolNombre || nombreRol(p.rolId) || p.nombre} (${p.nombre.trim().toLowerCase() || papelDePaso(i, pasos.length)})`).join(" → ");
}

type RolDeFlujo = Pick<Rol, "id" | "nombre" | "activo" | "permisos">;

/** Why these steps can't be saved as the flow of this kind, or null. */
export function revisarPasos(tipo: TipoFlujo, pasos: { nombre: string; rolId: string }[], roles: RolDeFlujo[]): string | null {
  if (pasos.length < MIN_PASOS) return `El flujo necesita al menos ${MIN_PASOS} pasos: quien elabora y quien aprueba.`;
  if (pasos.length > MAX_PASOS) return `El flujo admite hasta ${MAX_PASOS} pasos.`;
  for (const [i, p] of pasos.entries()) {
    const n = i + 1;
    if (!p.nombre.trim() || p.nombre.length > 40) return `Paso ${n}: escribe su nombre (hasta 40 caracteres).`;
    const rol = roles.find((r) => r.id === p.rolId);
    if (!rol) return `Paso ${n}: el rol elegido no existe en la empresa.`;
    if (!rol.activo) return `Paso ${n}: el rol ${rol.nombre} está desactivado.`;
    const permiso = permisoDePaso(tipo, i);
    if (!rol.permisos.includes(permiso)) {
      const accion = permiso.split(".")[1] === "aprobar" ? "aprobar" : i === 0 && tipoFlujo(tipo).accionInicial === "editar" ? "editar" : "crear";
      return `Paso ${n}: el rol ${rol.nombre} no tiene permiso de ${accion} en ${tipoFlujo(tipo).nombre.toLowerCase()}. Dáselo en Roles y permisos o elige otro rol.`;
    }
  }
  return null;
}

/** Warnings about a flow that is saved but may get stuck: a step nobody can take today. */
export function avisosFlujo(tipo: TipoFlujo, pasos: PasoFlujo[], roles: RolDeFlujo[], personasPorRol: Record<string, string[]>): string[] {
  if (!pasos.length) return [];
  const avisos: string[] = [];
  const problema = revisarPasos(tipo, pasos, roles);
  if (problema) avisos.push(`${problema} Los documentos se quedarían detenidos en ese paso.`);
  for (const [i, p] of pasos.entries()) {
    const rol = roles.find((r) => r.id === p.rolId);
    if (rol && !(personasPorRol[p.rolId]?.length)) avisos.push(`Paso ${i + 1} (${p.nombre}): nadie tiene hoy el rol ${rol.nombre} en este proyecto.`);
  }
  // One person signs one step: a role in two steps needs two different people with it.
  const repetidos = [...new Set(pasos.map((p) => p.rolId).filter((id, i, l) => l.indexOf(id) !== i))];
  for (const id of repetidos) {
    const rol = roles.find((r) => r.id === id);
    if (rol && (personasPorRol[id]?.length ?? 0) < pasos.filter((p) => p.rolId === id).length) {
      avisos.push(`El rol ${rol.nombre} está en varios pasos: hacen falta tantas personas distintas con ese rol (una persona firma un solo paso).`);
    }
  }
  return avisos;
}

/** The flows suggested from the initial roles (only those whose roles exist and are active). */
export function flujosSugeridos(roles: Pick<Rol, "id" | "clave" | "nombre" | "activo">[]): Partial<Record<TipoFlujo, PasoFlujo[]>> {
  const SUGERIDOS: Record<TipoFlujo, [string, string][]> = {
    acta_cliente: [["Elabora", "residente"], ["Preaprueba", "director"], ["Aprueba", "interventoria"]],
    acta_subcontrato: [["Elabora", "residente"], ["Aprueba", "director"]],
    inspeccion: [["Inspecciona", "residente"], ["Aprueba", "inspector"]],
    cierre_nc: [["Envía a verificar", "residente"], ["Verifica y cierra", "responsable_tecnico"]],
    vale_salida: [["Elabora", "almacenista"], ["Aprueba", "residente"]],
  };
  const out: Partial<Record<TipoFlujo, PasoFlujo[]>> = {};
  for (const [tipo, pasos] of Object.entries(SUGERIDOS) as [TipoFlujo, [string, string][]][]) {
    const con = pasos.map(([nombre, clave]) => {
      const rol = roles.find((r) => r.clave === clave && r.activo);
      return rol ? { nombre, rolId: rol.id, rolNombre: rol.nombre } : null;
    });
    if (con.every(Boolean)) out[tipo] = con as PasoFlujo[];
  }
  return out;
}

/** Who holds each role in the project today, by role id. */
export function personasPorRol(asignaciones: Asignacion[], vigente: (a: Asignacion) => boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of asignaciones) if (vigente(a)) (out[a.rolId] ??= []).push(a.nombre || a.email || a.userId);
  return out;
}

// ---------------------------------------------------------------- a document in its flow

export interface DocumentoEnFlujo {
  estado: EstadoFlujo;
  /** Who created it: never approves it. */
  elaboradoPorId: string;
  /** null until it is first sent. */
  flujo: FlujoDocumento | null;
}

/** Who acts: their Trimble id, their role in the project and their permissions today. */
export interface ActorFlujo {
  id: string;
  rolId: string | null;
  permisos: readonly Permiso[];
}

export interface ResultadoFlujo {
  estado: EstadoFlujo;
  flujo: FlujoDocumento | null;
  desde: number;
  hasta: number;
  /** The step acted on (null: anular before sending). */
  paso: PasoFlujo | null;
}

/**
 * Applies an action of `actor` to a document. `pasosVigentes` is the project's
 * flow now (used only when the document is sent for the first time). Returns
 * the new state or why it is refused.
 */
export function accionFlujo(
  tipo: TipoFlujo,
  doc: DocumentoEnFlujo,
  accion: AccionFlujo,
  actor: ActorFlujo,
  opciones: { motivo?: string; pasosVigentes: PasoFlujo[] | null }
): ResultadoFlujo | MotivoRechazo {
  const t = tipoFlujo(tipo);
  const motivo = (opciones.motivo ?? "").trim();
  const flujo = doc.flujo;
  const pasoActual = flujo?.paso ?? 0;

  if (accion === "anular") {
    if (doc.estado === "anulado" || doc.estado === "aprobado") return "estado-no-permite";
    if (!tiene(actor.permisos, t.modulo, "anular")) return "sin-permiso";
    if (!motivo) return "motivo-requerido";
    return { estado: "anulado", flujo, desde: pasoActual, hasta: pasoActual, paso: flujo?.pasos[pasoActual] ?? null };
  }

  if (accion === "enviar") {
    if (doc.estado !== "borrador" && doc.estado !== "devuelto") return "estado-no-permite";
    const pasos = flujo?.pasos ?? opciones.pasosVigentes;
    if (!pasos || pasos.length < MIN_PASOS) return "sin-flujo";
    if (actor.rolId !== pasos[0].rolId) return "paso-ajeno";
    if (!tiene(actor.permisos, t.modulo, t.accionInicial)) return "sin-permiso";
    return { estado: "en_tramite", flujo: { pasos, paso: 1, firmas: { "0": actor.id } }, desde: 0, hasta: 1, paso: pasos[0] };
  }

  // aprobar / devolver: the step the document waits for.
  if (doc.estado !== "en_tramite" || !flujo || pasoActual < 1 || pasoActual >= flujo.pasos.length) return "estado-no-permite";
  const paso = flujo.pasos[pasoActual];
  if (actor.rolId !== paso.rolId) return "paso-ajeno";
  if (!tiene(actor.permisos, t.modulo, "aprobar")) return "sin-permiso";
  const otrasFirmas = Object.entries(flujo.firmas).filter(([k]) => Number(k) !== pasoActual).map(([, id]) => id);
  if (actor.id === doc.elaboradoPorId || otrasFirmas.includes(actor.id)) return "auto-aprobacion";

  if (accion === "aprobar") {
    const firmas = { ...flujo.firmas, [String(pasoActual)]: actor.id };
    const final = pasoActual === flujo.pasos.length - 1;
    return {
      estado: final ? "aprobado" : "en_tramite",
      flujo: { ...flujo, paso: pasoActual + 1, firmas },
      desde: pasoActual,
      hasta: pasoActual + 1,
      paso,
    };
  }

  // devolver: back one step; that step's signature no longer counts.
  if (!motivo) return "motivo-requerido";
  const hasta = pasoActual - 1;
  const firmas = hasta === 0 ? {} : Object.fromEntries(Object.entries(flujo.firmas).filter(([k]) => Number(k) < hasta));
  return { estado: hasta === 0 ? "devuelto" : "en_tramite", flujo: { ...flujo, paso: hasta, firmas }, desde: pasoActual, hasta, paso };
}

/** The step a document waits for, or null (draft, returned, approved, cancelled). */
export function pasoPendiente(doc: Pick<DocumentoEnFlujo, "estado" | "flujo">): PasoFlujo | null {
  return doc.estado === "en_tramite" && doc.flujo ? doc.flujo.pasos[doc.flujo.paso] ?? null : null;
}

/** The actions this person could take on the document now (for the buttons). */
export function accionesPosibles(tipo: TipoFlujo, doc: DocumentoEnFlujo, actor: ActorFlujo, pasosVigentes: PasoFlujo[] | null): AccionFlujo[] {
  const acciones: AccionFlujo[] = ["enviar", "aprobar", "devolver", "anular"];
  return acciones.filter((a) => typeof accionFlujo(tipo, doc, a, actor, { motivo: "x", pasosVigentes }) !== "string");
}
