/**
 * Reading the Trimble permissions of a flow's folders to warn, never to change
 * them (the owner's decision): step responsibles who couldn't open the files,
 * and, for older flows with a destination folder, who could upload straight
 * to it and approvers whose own session couldn't copy there.
 * Pure: the service passes the ACLs Trimble gave and the team.
 */
import type { AccessLevel, FolderPermissions } from "../trimbleApi";
import { nombreResponsable } from "./flujos";
import type { AvisoPermisos, CarpetaFlujo, Flujo, PermisosCarpeta, Responsable } from "./types";

export type Acl = Partial<Record<AccessLevel, string[]>>;

/** The ACL that applies to a folder: its own entries, plus the inherited ones unless inheritance is off. */
export function aclEfectiva(p: FolderPermissions): Acl {
  const niveles: AccessLevel[] = ["FULL_ACCESS", "READ", "NO_ACCESS"];
  const out: Acl = {};
  for (const nivel of niveles) {
    const lista = [...(p.direct.acl[nivel] ?? []), ...(p.direct.inheritance ? (p.inherited[nivel] ?? []) : [])];
    if (lista.length) out[nivel] = [...new Set(lista)];
  }
  return out;
}

const TODOS = "tc-groups:*";
const RANGO: Record<AccessLevel, number> = { NO_ACCESS: 0, READ: 1, FULL_ACCESS: 2 };

const nivelDe = (acl: Acl, principal: string): AccessLevel | null => {
  for (const nivel of ["FULL_ACCESS", "READ", "NO_ACCESS"] as AccessLevel[]) if (acl[nivel]?.includes(principal)) return nivel;
  return null;
};

export interface Equipo {
  /** id → name, and whether they administer the project (administrators see every folder). */
  personas: Map<string, { nombre: string; admin: boolean }>;
  grupos: Map<string, string>;
  /** group id → its members' ids (for the groups that matter here). */
  miembros: Map<string, Set<string>>;
}

/**
 * The access Trimble lists for a person or a group on a folder: an entry for
 * the person themself wins; otherwise the highest among their groups and
 * "every member". null when nothing in the list applies to them.
 */
export function accesoDe(acl: Acl, quien: { tipo: "persona" | "grupo"; id: string }, equipo: Equipo): AccessLevel | null {
  if (quien.tipo === "persona") {
    if (equipo.personas.get(quien.id)?.admin) return "FULL_ACCESS";
    const propio = nivelDe(acl, `users:${quien.id}`);
    if (propio) return propio;
  }
  const principales = [TODOS, ...(quien.tipo === "grupo" ? [`tc-groups:${quien.id}`] : [...equipo.miembros].filter(([, m]) => m.has(quien.id)).map(([g]) => `tc-groups:${g}`))];
  let mejor: AccessLevel | null = null;
  for (const p of principales) {
    const n = nivelDe(acl, p);
    if (n && (!mejor || RANGO[n] > RANGO[mejor])) mejor = n;
  }
  return mejor;
}

/** "Juan Pérez", "Arquitectura (grupo)", "Todos los miembros del proyecto". */
export function nombrePrincipal(principal: string, equipo: Equipo): string {
  if (principal === TODOS) return "Todos los miembros del proyecto";
  const [tipo, id] = [principal.slice(0, principal.indexOf(":")), principal.slice(principal.indexOf(":") + 1)];
  if (tipo === "users") return equipo.personas.get(id)?.nombre ?? "Usuario ya no disponible";
  return `${equipo.grupos.get(id) ?? "Grupo ya no disponible"} (grupo)`;
}

const unicos = <T extends { tipo: string; id: string }>(xs: T[]) => [...new Map(xs.map((x) => [`${x.tipo}:${x.id}`, x])).values()];
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const vacia = (acl: Acl) => !acl.FULL_ACCESS?.length && !acl.READ?.length && !acl.NO_ACCESS?.length;

/**
 * The warnings about a flow, and who has what on each folder, in words:
 * - a step without responsible (only an administrator could decide it);
 * - in each folder with files of the flow, a responsible who doesn't appear
 *   with access (they couldn't open the files);
 * - for an older flow with a destination folder: who could upload straight to
 *   it, and an approver whose own session couldn't copy there.
 */
export function revisarPermisos(
  flujo: Pick<Flujo, "pasos" | "destino">,
  carpetas: { carpeta: CarpetaFlujo; acl: Acl }[],
  destinoAcl: Acl | null,
  equipo: Equipo
): { avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] } {
  const avisos: AvisoPermisos[] = [];
  for (const p of flujo.pasos) if (!p.responsable) avisos.push({ tipo: "falla", texto: `«${p.nombre}» no tiene responsable: solo un administrador podrá decidirlo. Edita el flujo y elígelo.` });
  const responsables = unicos(flujo.pasos.filter((p) => p.responsable).map((p) => p.responsable!)).map((r) => ({
    ...r,
    texto: `${nombreResponsable(r)} («${flujo.pasos.filter((p) => p.responsable?.tipo === r.tipo && p.responsable.id === r.id).map((p) => p.nombre).join("», «")}»)`,
  }));

  // Folders with files of the flow: responsibles who can't open them.
  for (const { carpeta, acl } of carpetas) {
    if (vacia(acl)) continue;
    for (const r of responsables) {
      const nivel = accesoDe(acl, r, equipo);
      if (nivel === null || nivel === "NO_ACCESS") avisos.push({ tipo: "falla", texto: `En «${carpeta.ruta}», ${r.texto} no aparece con acceso: no podrá abrir los archivos del flujo.` });
    }
  }

  // Destination of an older flow: who could upload without the flow, and approvers who couldn't copy.
  const d = destinoAcl ?? {};
  if (flujo.destino && destinoAcl) {
    const ultimo = flujo.pasos[flujo.pasos.length - 1];
    const aprobador = ultimo?.responsable ?? null;
    if (vacia(d)) {
      avisos.push({ tipo: "info", texto: `Trimble no lista permisos para la carpeta destino «${flujo.destino.ruta}»: revisa en Trimble quién puede subir archivos ahí.` });
    } else {
      if (d.FULL_ACCESS?.includes(TODOS)) {
        avisos.push({ tipo: "riesgo", texto: `En la carpeta destino «${flujo.destino.ruta}» todos los miembros del proyecto tienen acceso completo: cualquiera puede subir archivos sin pasar por el flujo.` });
      }
      const esAprobador = (p: string) => !!aprobador && p === (aprobador.tipo === "persona" ? `users:${aprobador.id}` : `tc-groups:${aprobador.id}`);
      const otros = (d.FULL_ACCESS ?? []).filter((p) => p !== TODOS && !esAprobador(p) && !(p.startsWith("users:") && equipo.personas.get(p.slice(6))?.admin));
      if (otros.length) {
        const uno = otros.length === 1;
        avisos.push({ tipo: "riesgo", texto: `En la carpeta destino también ${uno ? "tiene" : "tienen"} acceso completo ${lista(otros.map((p) => nombrePrincipal(p, equipo)))}: ${uno ? "puede" : "pueden"} subir archivos sin pasar por el flujo.` });
      }
      if (aprobador && accesoDe(d, aprobador, equipo) !== "FULL_ACCESS") {
        avisos.push({ tipo: "falla", texto: `${nombreResponsable(aprobador)} aprueba («${ultimo.nombre}») pero no aparece con acceso completo a la carpeta destino: la copia con su usuario fallaría y la tendría que hacer un administrador.` });
      }
    }
  }

  const tabla = (c: CarpetaFlujo, acl: Acl, papel: PermisosCarpeta["papel"]): PermisosCarpeta => ({
    ruta: c.ruta,
    papel,
    completo: (acl.FULL_ACCESS ?? []).map((p) => nombrePrincipal(p, equipo)),
    lectura: (acl.READ ?? []).map((p) => nombrePrincipal(p, equipo)),
    sinAcceso: (acl.NO_ACCESS ?? []).map((p) => nombrePrincipal(p, equipo)),
  });
  return {
    avisos,
    carpetas: [...(flujo.destino && destinoAcl ? [tabla(flujo.destino, d, "destino")] : []), ...carpetas.map((c) => tabla(c.carpeta, c.acl, "revision"))],
  };
}

/** The groups whose members matter for these ACLs and responsibles. */
export function gruposQueImportan(acls: Acl[], responsables: Pick<Responsable, "tipo" | "id">[]): string[] {
  const ids = new Set<string>();
  for (const acl of acls) for (const p of Object.values(acl).flat()) if (p && p.startsWith("tc-groups:") && p !== TODOS) ids.add(p.slice("tc-groups:".length));
  for (const r of responsables) if (r.tipo === "grupo") ids.add(r.id);
  return [...ids];
}
