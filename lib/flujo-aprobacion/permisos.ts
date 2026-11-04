/**
 * Reading a flow's folders' Trimble permissions to warn, never to change them
 * (the owner's decision): who could upload straight to the destination folder
 * without going through the flow, approvers whose own session couldn't copy
 * there, and people assigned in a review folder who can't open or upload in it.
 * Pure: the service passes the ACLs Trimble gave and the team.
 */
import type { AccessLevel, FolderPermissions } from "../trimbleApi";
import { dentroDe, PAPEL_REALIZA } from "./flujos";
import type { Asignacion, AvisoPermisos, CarpetaFlujo, Flujo, PermisosCarpeta } from "./types";

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

const quienDe = (a: Asignacion) => ({ tipo: a.quienTipo, id: a.quienId, nombre: a.quienTipo === "grupo" ? `${a.quienNombre} (grupo)` : a.quienNombre });
const unicos = <T extends { tipo: string; id: string }>(xs: T[]) => [...new Map(xs.map((x) => [`${x.tipo}:${x.id}`, x])).values()];
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** The warnings about a flow's folders, and who has what on each, in words. */
export function revisarPermisos(
  flujo: Pick<Flujo, "pasos" | "carpetas" | "destino">,
  asignaciones: Asignacion[],
  acls: { destino: Acl; carpetas: Map<string, Acl> },
  equipo: Equipo
): { avisos: AvisoPermisos[]; carpetas: PermisosCarpeta[] } {
  const avisos: AvisoPermisos[] = [];
  const activas = asignaciones.filter((a) => a.activa);
  const ultimo = flujo.pasos[flujo.pasos.length - 1];
  const aprobadores = unicos(activas.filter((a) => a.papel === ultimo?.id).map(quienDe));
  const d = acls.destino;
  const vacia = (acl: Acl) => !acl.FULL_ACCESS?.length && !acl.READ?.length && !acl.NO_ACCESS?.length;

  // Destination: who could upload without the flow, and approvers who couldn't copy.
  if (vacia(d)) {
    avisos.push({ tipo: "info", texto: `Trimble no lista permisos para la carpeta destino «${flujo.destino.ruta}»: revisa en Trimble quién puede subir archivos ahí.` });
  } else {
    if (d.FULL_ACCESS?.includes(TODOS)) {
      avisos.push({ tipo: "riesgo", texto: `En la carpeta destino «${flujo.destino.ruta}» todos los miembros del proyecto tienen acceso completo: cualquiera puede subir archivos sin pasar por el flujo.` });
    }
    const esAprobador = (p: string) => aprobadores.some((q) => p === (q.tipo === "persona" ? `users:${q.id}` : `tc-groups:${q.id}`));
    const otros = (d.FULL_ACCESS ?? []).filter((p) => p !== TODOS && !esAprobador(p) && !(p.startsWith("users:") && equipo.personas.get(p.slice(6))?.admin));
    if (otros.length) {
      const uno = otros.length === 1;
      avisos.push({ tipo: "riesgo", texto: `En la carpeta destino también ${uno ? "tiene" : "tienen"} acceso completo ${lista(otros.map((p) => nombrePrincipal(p, equipo)))}: ${uno ? "puede" : "pueden"} subir archivos sin pasar por el flujo.` });
    }
  }
  for (const q of aprobadores) {
    if (accesoDe(d, q, equipo) !== "FULL_ACCESS" && !vacia(d)) {
      avisos.push({ tipo: "falla", texto: `${q.nombre} aprueba («${ultimo.nombre}») pero no aparece con acceso completo a la carpeta destino: la copia con su usuario fallaría y la tendría que hacer un administrador.` });
    }
  }

  // Review folders: people assigned there who can't open, or can't upload when they "Realiza".
  for (const c of flujo.carpetas) {
    const acl = acls.carpetas.get(c.id) ?? {};
    if (vacia(acl)) continue;
    const aqui = activas.filter((a) => dentroDe({ id: a.objetivoId, ancestros: a.objetivoAncestros }, c.id));
    for (const q of unicos(aqui.map(quienDe))) {
      const nivel = accesoDe(acl, q, equipo);
      const realiza = aqui.some((a) => a.papel === PAPEL_REALIZA && a.quienId === q.id);
      if (nivel === null || nivel === "NO_ACCESS") avisos.push({ tipo: "falla", texto: `En «${c.ruta}», ${q.nombre} no aparece con acceso: no podrá abrir los archivos.` });
      else if (realiza && nivel === "READ") avisos.push({ tipo: "falla", texto: `En «${c.ruta}», ${q.nombre} realiza pero solo tiene lectura: no podrá subir archivos.` });
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
    carpetas: [tabla(flujo.destino, d, "destino"), ...flujo.carpetas.map((c) => tabla(c, acls.carpetas.get(c.id) ?? {}, "revision"))],
  };
}

/** The groups whose members matter for these ACLs and assignments. */
export function gruposQueImportan(acls: Acl[], asignaciones: Asignacion[]): string[] {
  const ids = new Set<string>();
  for (const acl of acls) for (const p of Object.values(acl).flat()) if (p && p.startsWith("tc-groups:") && p !== TODOS) ids.add(p.slice("tc-groups:".length));
  for (const a of asignaciones) if (a.activa && a.quienTipo === "grupo") ids.add(a.quienId);
  return [...ids];
}
