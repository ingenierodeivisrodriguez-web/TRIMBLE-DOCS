// Building blocks of a budget document: the empty budget, resolvers for the
// catalog and the budget, and copying catalog partidas into a budget.
import { pieInicial, Resolver } from "./calc";
import type {
  Apu,
  Componente,
  Insumo,
  InsumoPresupuesto,
  ItemPartida,
  PartidaCatalogo,
  PresupuestoDoc,
  Subpartida,
  Subpresupuesto,
} from "./types";

export const JORNADA = 8;

export function nuevoId(): string {
  return globalThis.crypto.randomUUID();
}

export function subpresupuestoVacio(nombre: string): Subpresupuesto {
  return { id: nuevoId(), nombre, items: [], pie: pieInicial() };
}

export function documentoVacio(): PresupuestoDoc {
  return {
    subpresupuestos: [subpresupuestoVacio("PRESUPUESTO GENERAL")],
    insumos: {},
    subpartidas: {},
    gastos: { fijos: [], variables: [] },
  };
}

/** Resolves an APU against the catalog: partidas used as subpartidas are other catalog partidas. */
export function resolverCatalogo(insumos: Map<string, Insumo>, partidas: Map<string, PartidaCatalogo>): Resolver {
  return {
    insumo: (id) => insumos.get(id) ?? null,
    subpartida: (id) => partidas.get(id) ?? null,
  };
}

/** Resolves an APU against the budget's own prices and subpartidas. */
export function resolverPresupuesto(doc: PresupuestoDoc): Resolver {
  return {
    insumo: (id) => doc.insumos[id] ?? null,
    subpartida: (id) => doc.subpartidas[id] ?? null,
  };
}

export function snapshotInsumo(ins: Insumo): InsumoPresupuesto {
  return {
    codigo: ins.codigo,
    descripcion: ins.descripcion,
    unidad: ins.unidad,
    precio: ins.precio,
    tipo: ins.tipo,
    iu: ins.iu,
    omniclass: ins.omniclass,
  };
}

/**
 * Brings what a catalog APU uses into the budget: its resources (keeping a
 * price the budget already has) and its subpartidas (reusing one copied
 * before from the same catalog partida). Returns the APU's components
 * pointing at the budget's subpartidas, and the updated maps.
 */
export function importarApu(
  apu: Apu,
  catalogo: { insumos: Map<string, Insumo>; partidas: Map<string, PartidaCatalogo> },
  doc: Pick<PresupuestoDoc, "insumos" | "subpartidas">,
  stack: string[] = []
): { componentes: Componente[]; insumos: Record<string, InsumoPresupuesto>; subpartidas: Record<string, Subpartida> } {
  let insumos = doc.insumos;
  let subpartidas = doc.subpartidas;
  const componentes: Componente[] = [];
  for (const c of apu.componentes) {
    if (c.tipo === "insumo") {
      const ins = catalogo.insumos.get(c.id);
      if (!ins) continue;
      if (!insumos[c.id]) insumos = { ...insumos, [c.id]: snapshotInsumo(ins) };
      componentes.push({ ...c });
      continue;
    }
    const origen = catalogo.partidas.get(c.id);
    if (!origen || stack.includes(c.id)) continue;
    const existente = Object.entries(subpartidas).find(([, s]) => s.origenId === c.id);
    if (existente) {
      componentes.push({ ...c, id: existente[0] });
      continue;
    }
    const id = nuevoId();
    // Reserve the id before going in, so a subpartida reached twice is copied once.
    subpartidas = { ...subpartidas, [id]: { ...copiaPartida(origen), componentes: [], origenId: c.id } };
    const dentro = importarApu(origen, catalogo, { insumos, subpartidas }, [...stack, c.id]);
    insumos = dentro.insumos;
    subpartidas = { ...dentro.subpartidas, [id]: { ...dentro.subpartidas[id], componentes: dentro.componentes } };
    componentes.push({ ...c, id });
  }
  return { componentes, insumos, subpartidas };
}

function copiaPartida(p: PartidaCatalogo) {
  return {
    codigo: p.codigo,
    descripcion: p.descripcion,
    unidad: p.unidad,
    omniclass: p.omniclass,
    rendimiento: p.rendimiento,
    jornada: p.jornada,
  };
}

/** A catalog partida as a new row of the budget (with what it uses brought in). */
export function partidaDesdeCatalogo(
  p: PartidaCatalogo,
  catalogo: { insumos: Map<string, Insumo>; partidas: Map<string, PartidaCatalogo> },
  doc: PresupuestoDoc
): { item: ItemPartida; insumos: Record<string, InsumoPresupuesto>; subpartidas: Record<string, Subpartida> } {
  const { componentes, insumos, subpartidas } = importarApu(p, catalogo, doc, [p.id]);
  return {
    item: { id: nuevoId(), tipo: "partida", nivel: 0, ...copiaPartida(p), componentes, metrado: 0, origenId: p.id },
    insumos,
    subpartidas,
  };
}

/** The ids of the subpartidas reachable from the budget's partidas. */
function subpartidasUsadas(doc: PresupuestoDoc): Set<string> {
  const usadas = new Set<string>();
  const pendientes: Apu[] = doc.subpresupuestos.flatMap((sp) => sp.items.filter((i): i is ItemPartida => i.tipo === "partida"));
  while (pendientes.length) {
    const apu = pendientes.pop()!;
    for (const c of apu.componentes) {
      if (c.tipo !== "subpartida" || usadas.has(c.id)) continue;
      const sub = doc.subpartidas[c.id];
      if (!sub) continue;
      usadas.add(c.id);
      pendientes.push(sub);
    }
  }
  return usadas;
}

/**
 * Drops subpartidas no partida reaches any more, and the prices of resources
 * nothing uses (they come back from the catalog if used again).
 */
export function limpiarDocumento(doc: PresupuestoDoc): PresupuestoDoc {
  const subIds = subpartidasUsadas(doc);
  const subpartidas: Record<string, Subpartida> = {};
  for (const id of subIds) subpartidas[id] = doc.subpartidas[id];
  const usados = new Set<string>();
  const apus: Apu[] = [
    ...doc.subpresupuestos.flatMap((sp) => sp.items.filter((i): i is ItemPartida => i.tipo === "partida")),
    ...Object.values(subpartidas),
  ];
  for (const apu of apus) for (const c of apu.componentes) if (c.tipo === "insumo") usados.add(c.id);
  const insumos: Record<string, InsumoPresupuesto> = {};
  for (const id of usados) if (doc.insumos[id]) insumos[id] = doc.insumos[id];
  return { ...doc, insumos, subpartidas };
}

/** True when `subId` (directly or through other subpartidas) contains `targetId`, so adding it would loop. */
export function creaCiclo(doc: Pick<PresupuestoDoc, "subpartidas">, subId: string, targetId: string): boolean {
  if (subId === targetId) return true;
  const visto = new Set<string>();
  const pendientes = [subId];
  while (pendientes.length) {
    const id = pendientes.pop()!;
    if (visto.has(id)) continue;
    visto.add(id);
    for (const c of doc.subpartidas[id]?.componentes ?? []) {
      if (c.tipo !== "subpartida") continue;
      if (c.id === targetId) return true;
      pendientes.push(c.id);
    }
  }
  return false;
}

/** Same as creaCiclo, for catalog partidas. */
export function creaCicloCatalogo(partidas: Map<string, PartidaCatalogo>, subId: string, targetId: string): boolean {
  const subpartidas: Record<string, Subpartida> = {};
  for (const [id, p] of partidas) subpartidas[id] = { ...p, origenId: null };
  return creaCiclo({ subpartidas }, subId, targetId);
}
