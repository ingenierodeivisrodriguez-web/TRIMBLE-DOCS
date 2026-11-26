/**
 * Who sees each flow (26-11-2026, phase 3 of the owner's plan: «que los flujos
 * solo las puedan visualizar los implicados… y solo quien tenga el rol de
 * administrador en trimble del proyecto pueda ver todos los flujos»). The
 * project's administrators see every flow; anyone else only the flows where
 * they are involved: they created it («Realiza»), they are responsible for one
 * of its steps (the person, or a member of the group), they uploaded one of its
 * files (the owner: «Sí, también»: they get the rejection e-mail), they signed
 * one of its files or put an approved version in a folder. Checked on the
 * server: lists, files, history, comments and traceability.
 */
import { FlujoError } from "./errores";
import type { Ctx } from "./service";
import type { ArchivoRegistro, Flujo, Responsable } from "./types";

export interface Quien {
  id: string;
  esAdmin: boolean;
  /** The groups (of the ones asked about) the caller belongs to. */
  grupos: Set<string>;
}

type FlujoVista = Pick<Flujo, "id" | "pasos" | "creadoPorId">;
type ArchivoVista = Pick<ArchivoRegistro, "flujoId" | "pasos" | "subidoPorId" | "firmas" | "traslado" | "versionNueva">;

export const NO_VISIBLE = "Este flujo no es tuyo: solo lo ven quien lo creó, los responsables de sus pasos, quienes subieron sus archivos y los administradores del proyecto.";

function responsables(f: FlujoVista, archivos: ArchivoVista[]): Responsable[] {
  return [...f.pasos, ...archivos.flatMap((a) => a.pasos)].map((p) => p.responsable).filter((r): r is Responsable => !!r);
}

/** The responsible groups of these flows (asked to Trimble once, to know which ones the caller belongs to). */
export function gruposDeFlujos(flujos: FlujoVista[], archivos: ArchivoVista[]): string[] {
  const porFlujo = new Map<string, ArchivoVista[]>();
  for (const a of archivos) porFlujo.set(a.flujoId, [...(porFlujo.get(a.flujoId) ?? []), a]);
  return [...new Set(flujos.flatMap((f) => responsables(f, porFlujo.get(f.id) ?? [])).filter((r) => r.tipo === "grupo").map((r) => r.id))];
}

/** Whether the caller sees this flow (`archivos`: its registered files). */
export function veFlujo(f: FlujoVista, archivos: ArchivoVista[], quien: Quien): boolean {
  if (quien.esAdmin) return true;
  const yo = quien.id;
  if (!yo) return false;
  if (f.creadoPorId === yo) return true;
  if (responsables(f, archivos).some((r) => (r.tipo === "persona" ? r.id === yo : quien.grupos.has(r.id)))) return true;
  return archivos.some(
    (a) => a.subidoPorId === yo || a.versionNueva?.subidoPorId === yo || a.firmas.some((x) => x.quienId === yo) || a.traslado?.porId === yo
  );
}

/** The ids of the flows the caller sees. */
export function idsVisibles(flujos: FlujoVista[], archivos: ArchivoVista[], quien: Quien): Set<string> {
  const porFlujo = new Map<string, ArchivoVista[]>();
  for (const a of archivos) porFlujo.set(a.flujoId, [...(porFlujo.get(a.flujoId) ?? []), a]);
  return new Set(flujos.filter((f) => veFlujo(f, porFlujo.get(f.id) ?? [], quien)).map((f) => f.id));
}

/** The project's flows and files, and which flows the caller sees (an administrator: all, without asking Trimble for groups). */
export async function flujosVisibles(ctx: Ctx): Promise<{ flujos: Flujo[]; archivos: ArchivoRegistro[]; visibles: Set<string> }> {
  const [flujos, archivos] = await Promise.all([ctx.store.flujos(ctx.projectId), ctx.store.archivos(ctx.projectId)]);
  if (ctx.caller.isAdmin) return { flujos, archivos, visibles: new Set(flujos.map((f) => f.id)) };
  const grupos = gruposDeFlujos(flujos, archivos);
  const mios = grupos.length && ctx.caller.memberOfGroups ? await ctx.caller.memberOfGroups(grupos) : new Set<string>();
  return { flujos, archivos, visibles: idsVisibles(flujos, archivos, { id: ctx.caller.id, esAdmin: false, grupos: mios }) };
}

/** Refuses a flow the caller doesn't see (403 «no-visible»). */
export async function exigirVisible(ctx: Ctx, flujoId: string): Promise<void> {
  if (ctx.caller.isAdmin) return;
  const { visibles } = await flujosVisibles(ctx);
  if (!visibles.has(flujoId)) throw new FlujoError(NO_VISIBLE, 403, "no-visible");
}
