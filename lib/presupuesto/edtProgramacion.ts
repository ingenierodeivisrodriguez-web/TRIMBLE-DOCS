// The schedule's own work breakdown (EDT/WBS): building it from the budget,
// editing its tree, keeping the 100 % rule, and splitting partidas into
// activities by location (from the memoria de cantidades of the model's
// elements, or typed), chained floor after floor.
import { redondear, SubpresupuestoCalculado } from "./calc";
import { creaCiclo, Programado, reglaDel100, tareasDe } from "./programacion";
import type { Actividad, Dependencia, ElementoVinculado, NodoEdt, PresupuestoDoc, Programacion } from "./types";
import { MAX_PREDECESORAS, SIN_DATO_UBICACION } from "./types";

const nuevoId = () => globalThis.crypto.randomUUID();

/**
 * The first EDT of the schedule: the budget's outline (subpresupuestos and
 * titles become nodes) and one activity per partida, of 100 % of it, with the
 * same id and settings it had, so baselines and progress reports keep
 * matching.
 */
export function edtDesdePresupuesto(doc: PresupuestoDoc, prog: Programacion): Programacion {
  const edt: NodoEdt[] = [];
  const actividades: Actividad[] = [];
  for (const sp of doc.subpresupuestos) {
    const raiz = `sp-${sp.id}`.slice(0, 64);
    edt.push({ id: raiz, padre: null, nombre: sp.nombre, responsable: "", ubicacion: [] });
    const abiertos: { id: string; nivel: number }[] = [];
    for (const item of sp.items) {
      while (abiertos.length && abiertos[abiertos.length - 1].nivel >= item.nivel) abiertos.pop();
      const padre = abiertos.length ? abiertos[abiertos.length - 1].id : raiz;
      if (item.tipo === "titulo") {
        edt.push({ id: item.id, padre, nombre: item.descripcion, responsable: "", ubicacion: [] });
        abiertos.push({ id: item.id, nivel: item.nivel });
        continue;
      }
      actividades.push({ ...(prog.tareas[item.id] ?? {}), id: item.id, nodo: padre, nombre: item.descripcion, asignaciones: [{ partida: item.id, pct: 100 }] });
    }
  }
  return { ...prog, tareas: {}, edt, actividades };
}

const SIN_CLASIFICAR = "SIN CLASIFICAR";

/**
 * Gives each partida that isn't 100 % assigned an activity with what is
 * missing: in the node of its budget title if the EDT still has it, else in
 * a "SIN CLASIFICAR" node at the top. Answers the schedule and how many it added.
 */
export function completarAsignaciones(
  doc: PresupuestoDoc,
  calculados: Map<string, SubpresupuestoCalculado>,
  prog: Programacion,
  soloEstas?: Set<string>
): { prog: Programacion; agregadas: number } {
  const { faltan } = reglaDel100(doc, calculados, prog);
  const pendientes = faltan.filter((f) => !soloEstas || soloEstas.has(f.partida));
  if (!pendientes.length) return { prog, agregadas: 0 };
  const edt = [...(prog.edt ?? [])];
  const nodos = new Set(edt.map((n) => n.id));
  // Each partida's nearest title in the budget.
  const titulo = new Map<string, string>();
  for (const sp of doc.subpresupuestos) {
    const abiertos: { id: string; nivel: number }[] = [];
    for (const item of sp.items) {
      while (abiertos.length && abiertos[abiertos.length - 1].nivel >= item.nivel) abiertos.pop();
      if (item.tipo === "titulo") abiertos.push({ id: item.id, nivel: item.nivel });
      else titulo.set(item.id, abiertos.length ? abiertos[abiertos.length - 1].id : `sp-${sp.id}`.slice(0, 64));
    }
  }
  let sinClasificar = edt.find((n) => n.padre === null && n.nombre === SIN_CLASIFICAR)?.id ?? null;
  const actividades = [...(prog.actividades ?? [])];
  for (const f of pendientes) {
    let nodo = titulo.get(f.partida);
    if (!nodo || !nodos.has(nodo)) {
      if (!sinClasificar) {
        sinClasificar = nuevoId();
        edt.push({ id: sinClasificar, padre: null, nombre: SIN_CLASIFICAR, responsable: "", ubicacion: [] });
        nodos.add(sinClasificar);
      }
      nodo = sinClasificar;
    }
    const resto = redondear(100 - f.pct, 4);
    // The same id as the partida when it is free (baselines of the budget's outline keep matching).
    const id = actividades.some((a) => a.id === f.partida) || nodos.has(f.partida) ? nuevoId() : f.partida;
    actividades.push({ id, nodo, nombre: f.pct > 0 ? `${f.descripcion} (resto)` : f.descripcion, asignaciones: [{ partida: f.partida, pct: resto }] });
  }
  return { prog: { ...prog, edt, actividades }, agregadas: pendientes.length };
}

// ---------------------------------------------------------------- editing the tree

/** The node and everything inside it (ids). */
export function descendientes(edt: NodoEdt[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const n of edt) {
      if (n.padre && out.has(n.padre) && !out.has(n.id)) {
        out.add(n.id);
        crecio = true;
      }
    }
  }
  return out;
}

/** "ESTRUCTURA > TORRE 1 > PISO 3" */
export function rutaNodo(edt: NodoEdt[], id: string): string {
  const porId = new Map(edt.map((n) => [n.id, n]));
  const partes: string[] = [];
  let n = porId.get(id);
  for (let k = 0; n && k < 50; k++) {
    partes.unshift(n.nombre);
    n = n.padre ? porId.get(n.padre) : undefined;
  }
  return partes.join(" > ");
}

/** Moves a node among its siblings (−1 up, +1 down). */
export function moverNodo(edt: NodoEdt[], id: string, dir: -1 | 1): NodoEdt[] {
  const n = edt.find((x) => x.id === id);
  if (!n) return edt;
  const hermanos = edt.filter((x) => x.padre === n.padre);
  const k = hermanos.indexOf(n);
  const otro = hermanos[k + dir];
  if (!otro) return edt;
  const out = [...edt];
  const i = out.indexOf(n);
  const j = out.indexOf(otro);
  out[i] = otro;
  out[j] = n;
  return out;
}

/** Puts a node inside another (or at the top); refused when it would go inside itself. */
export function cambiarPadre(edt: NodoEdt[], id: string, padre: string | null): NodoEdt[] | { error: string } {
  if (padre && descendientes(edt, id).has(padre)) return { error: "Un paquete no puede quedar dentro de sí mismo ni de lo que contiene." };
  return edt.map((n) => (n.id === id ? { ...n, padre } : n));
}

/**
 * Removes a node: what it holds (nodes and activities) goes to its parent. A
 * node at the top with activities can't be removed: they would have no place.
 */
export function eliminarNodo(prog: Programacion, id: string): Programacion | { error: string } {
  const edt = prog.edt ?? [];
  const n = edt.find((x) => x.id === id);
  if (!n) return prog;
  const actividades = prog.actividades ?? [];
  if (!n.padre && actividades.some((a) => a.nodo === id)) return { error: "Tiene actividades y no está dentro de otro paquete: muévelas antes de eliminarlo." };
  return {
    ...prog,
    edt: edt.filter((x) => x.id !== id).map((x) => (x.padre === id ? { ...x, padre: n.padre } : x)),
    actividades: actividades.map((a) => (a.nodo === id ? { ...a, nodo: n.padre! } : a)),
  };
}

/** Removes activities and the links to them. */
export function eliminarActividades(prog: Programacion, ids: Set<string>): Programacion {
  return {
    ...prog,
    actividades: (prog.actividades ?? [])
      .filter((a) => !ids.has(a.id))
      .map((a) => {
        if (!a.predecesoras?.some((d) => ids.has(d.id))) return a;
        const predecesoras = a.predecesoras.filter((d) => !ids.has(d.id));
        const { predecesoras: _p, ...resto } = a;
        return predecesoras.length ? { ...resto, predecesoras } : resto;
      }),
  };
}

// ---------------------------------------------------------------- by location

/** Natural order: "PISO 2" before "PISO 10". */
export function ordenNatural(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

export const SIN_DATO = SIN_DATO_UBICACION;

export interface Ubicacion {
  valor: string;
  /** % of each partida done there. */
  pcts: Record<string, number>;
}

/** Shares that add up to exactly 100 (to 4 decimals): the rounding goes to the largest. */
function porcentajes(pesos: number[]): number[] {
  const total = pesos.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return pesos.map(() => 0);
  const out = pesos.map((x) => redondear((x / total) * 100, 4));
  const diff = redondear(100 - out.reduce((a, b) => a + b, 0), 4);
  if (diff !== 0) {
    let k = 0;
    pesos.forEach((x, i) => {
      if (x > pesos[k]) k = i;
    });
    out[k] = redondear(out[k] + diff, 4);
  }
  return out;
}

/**
 * How the partidas' elements are spread over the values of a column of the
 * memoria de cantidades (e.g. Nivel): each partida's % in each place, by its
 * measured quantity (by count when it doesn't measure). Elements without the
 * value go to "(sin dato)". Places in natural order.
 */
export function repartoDelModelo(elementos: Pick<ElementoVinculado, "itemId" | "cantidad" | "memoria">[], partidas: string[], columna: string): { ubicaciones: Ubicacion[]; sinElementos: string[] } {
  const quiero = new Set(partidas);
  const porPartida = new Map<string, Map<string, { cantidad: number; cuenta: number }>>();
  for (const e of elementos) {
    if (!quiero.has(e.itemId)) continue;
    const valor = (e.memoria?.[columna] ?? "").trim() || SIN_DATO;
    const m = porPartida.get(e.itemId) ?? new Map<string, { cantidad: number; cuenta: number }>();
    const x = m.get(valor) ?? { cantidad: 0, cuenta: 0 };
    x.cantidad += e.cantidad ?? 0;
    x.cuenta++;
    m.set(valor, x);
    porPartida.set(e.itemId, m);
  }
  const valores = new Set<string>();
  for (const m of porPartida.values()) for (const v of m.keys()) valores.add(v);
  const lista = [...valores].sort((a, b) => (a === SIN_DATO ? 1 : b === SIN_DATO ? -1 : ordenNatural(a, b)));
  const ubicaciones: Ubicacion[] = lista.map((valor) => ({ valor, pcts: {} }));
  for (const [partida, m] of porPartida) {
    const porCantidad = [...m.values()].some((x) => x.cantidad > 0);
    const pesos = lista.map((v) => {
      const x = m.get(v);
      return x ? (porCantidad ? x.cantidad : x.cuenta) : 0;
    });
    porcentajes(pesos).forEach((pct, i) => {
      if (pct > 0) ubicaciones[i].pcts[partida] = pct;
    });
  }
  return { ubicaciones: ubicaciones.filter((u) => Object.keys(u.pcts).length), sinElementos: partidas.filter((p) => !porPartida.has(p)) };
}

/** Typed places, each partida split equally among them. */
export function repartoIgual(nombres: string[], partidas: string[]): Ubicacion[] {
  const valores = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  const pct = porcentajes(valores.map(() => 1));
  return valores.map((valor, i) => ({ valor, pcts: Object.fromEntries(partidas.map((p) => [p, pct[i]])) }));
}

export interface OpcionesDivision {
  /** In the order they are done in each place. */
  partidas: { id: string; descripcion: string }[];
  /** In the order they are done. */
  ubicaciones: Ubicacion[];
  /** The column the places come from (the new nodes filter the model by it), or null if typed. */
  columna: string | null;
  /** Where the places' nodes go. */
  padre: string;
  /** Each place gets its own node (else the activities go right into `padre`). */
  nodoPorUbicacion: boolean;
  /** In each place, each partida after the previous one (finish to start, with this lag in days). */
  enCadaUbicacion: { desfase: number } | null;
  /** Each partida after itself in the previous place. */
  entreUbicaciones: { desfase: number } | null;
}

/**
 * Splits partidas into activities by place: each partida's current
 * activities give way (their part of it), and in each place one activity per
 * partida does its % there, optionally chained as a train (the classic
 * floor-by-floor sequence). The links of the activities that go away move to
 * the train: what came before them now comes before its first activity, and
 * what came after them, after its last.
 */
export function dividirPorUbicacion(prog: Programacion, o: OpcionesDivision): { prog: Programacion; creadas: number; reemplazadas: number } {
  const partidas = new Set(o.partidas.map((p) => p.id));
  let edt = [...(prog.edt ?? [])];
  const viejas = prog.actividades ?? [];
  // The activities that lose their part of these partidas, and those that are left empty.
  const vaciadas = new Set<string>();
  const predecesorasDe = new Map<string, Dependencia[]>(); // partida -> links into its old activities
  const quedan: Actividad[] = [];
  for (const a of viejas) {
    const propias = a.asignaciones.filter((x) => partidas.has(x.partida));
    if (!propias.length) {
      quedan.push(a);
      continue;
    }
    for (const x of propias) predecesorasDe.set(x.partida, [...(predecesorasDe.get(x.partida) ?? []), ...(a.predecesoras ?? [])]);
    const resto = a.asignaciones.filter((x) => !partidas.has(x.partida));
    if (resto.length) quedan.push({ ...a, asignaciones: resto });
    else vaciadas.add(a.id);
  }
  const ultimaDe = new Map<string, string>(); // old activity -> what replaces it for its successors
  const creadas: Actividad[] = [];
  const primera = new Map<string, string>();
  const anterior = new Map<string, string>(); // partida -> its activity in the previous place
  for (const u of o.ubicaciones) {
    let nodo = o.padre;
    if (o.nodoPorUbicacion) {
      const existente = edt.find((n) => n.padre === o.padre && n.nombre.trim().toUpperCase() === u.valor.trim().toUpperCase());
      if (existente) nodo = existente.id;
      else {
        nodo = nuevoId();
        edt = [...edt, { id: nodo, padre: o.padre, nombre: u.valor, responsable: "", ubicacion: o.columna ? [{ columna: o.columna, valor: u.valor }] : [] }];
      }
    }
    let previa: string | null = null;
    for (const p of o.partidas) {
      const pct = u.pcts[p.id];
      if (!pct) continue;
      const id = nuevoId();
      const predecesoras: Dependencia[] = [];
      if (o.enCadaUbicacion && previa) predecesoras.push({ id: previa, tipo: "FC", desfase: o.enCadaUbicacion.desfase });
      const antes = anterior.get(p.id);
      if (o.entreUbicaciones && antes) predecesoras.push({ id: antes, tipo: "FC", desfase: o.entreUbicaciones.desfase });
      if (!primera.has(p.id)) {
        primera.set(p.id, id);
        // What came before its old activities now comes before the train (minus links to activities that go away).
        for (const d of predecesorasDe.get(p.id) ?? []) if (!vaciadas.has(d.id) && !predecesoras.some((x) => x.id === d.id)) predecesoras.push(d);
      }
      creadas.push({ id, nodo, nombre: `${p.descripcion} - ${u.valor}`, asignaciones: [{ partida: p.id, pct }], ...(predecesoras.length ? { predecesoras: predecesoras.slice(0, MAX_PREDECESORAS) } : {}) });
      anterior.set(p.id, id);
      previa = id;
    }
  }
  for (const a of viejas) {
    if (!vaciadas.has(a.id)) continue;
    const p = a.asignaciones.find((x) => partidas.has(x.partida));
    const ultima = p ? anterior.get(p.partida) : undefined;
    if (ultima) ultimaDe.set(a.id, ultima);
  }
  // What came after the old activities now comes after the last activity of the train.
  const reenlazadas = quedan.map((a) => {
    if (!a.predecesoras?.some((d) => vaciadas.has(d.id))) return a;
    const vistas = new Set<string>();
    const predecesoras: Dependencia[] = [];
    for (const d of a.predecesoras) {
      const id = vaciadas.has(d.id) ? ultimaDe.get(d.id) : d.id;
      if (!id || vistas.has(id)) continue;
      vistas.add(id);
      predecesoras.push({ ...d, id });
    }
    const { predecesoras: _p, ...resto } = a;
    return predecesoras.length ? { ...resto, predecesoras } : resto;
  });
  return { prog: { ...prog, edt, actividades: [...reenlazadas, ...creadas] }, creadas: creadas.length, reemplazadas: vaciadas.size };
}

// ---------------------------------------------------------------- what the assistant proposes

/** An activity's accepted proposal: its package (a path inside the scope; null: not applied) and predecessors (null: not applied). */
export interface CambioPrograma {
  id: string;
  paquete: string[] | null;
  predecesoras: Dependencia[] | null;
}

/**
 * Applies accepted proposals: moves each activity to its package (creating
 * the nodes of the path inside the scope that don't exist) and adds its
 * predecessors to the ones it has (or replaces them), leaving out any that
 * would close a loop.
 */
export function aplicarPrograma(prog: Programacion, alcance: string | null, cambios: CambioPrograma[], reemplazar: boolean): { prog: Programacion; movidas: number; enlaces: number; descartados: number } {
  const edt = [...(prog.edt ?? [])];
  const existentes = new Set((prog.actividades ?? []).map((x) => x.id));
  const nodoDe = (ruta: string[]): string | null => {
    let padre = alcance;
    for (const nombre of ruta) {
      let n = edt.find((x) => x.padre === padre && x.nombre.trim().toUpperCase() === nombre.trim().toUpperCase());
      if (!n) {
        n = { id: nuevoId(), padre, nombre, responsable: "", ubicacion: [] };
        edt.push(n);
      }
      padre = n.id;
    }
    return padre;
  };
  const tareas = { ...tareasDe(prog) };
  const nodos = new Map<string, string>();
  let movidas = 0;
  let enlaces = 0;
  let descartados = 0;
  for (const c of cambios) {
    if (!existentes.has(c.id)) continue;
    if (c.paquete?.length) {
      const nodo = nodoDe(c.paquete);
      if (nodo) nodos.set(c.id, nodo);
    }
    if (!c.predecesoras) continue;
    const actuales = reemplazar ? [] : [...(tareas[c.id]?.predecesoras ?? [])];
    for (const d of c.predecesoras) {
      if (!existentes.has(d.id) || d.id === c.id || actuales.some((x) => x.id === d.id) || actuales.length >= MAX_PREDECESORAS) continue;
      if (creaCiclo(tareas, c.id, [...actuales.map((x) => x.id), d.id])) {
        descartados++;
        continue;
      }
      actuales.push(d);
      enlaces++;
      tareas[c.id] = { ...tareas[c.id], predecesoras: [...actuales] };
    }
    if (reemplazar && !actuales.length && tareas[c.id]) {
      const { predecesoras: _p, ...resto } = tareas[c.id];
      tareas[c.id] = resto;
    }
  }
  const actividades = (prog.actividades ?? []).map((x) => {
    const nodo = nodos.get(x.id);
    if (nodo && nodo !== x.nodo) movidas++;
    const t = tareas[x.id] ?? {};
    const { predecesoras: _p, ...sin } = x;
    return { ...sin, nodo: nodo ?? x.nodo, ...(t.predecesoras?.length ? { predecesoras: t.predecesoras } : {}) };
  });
  return { prog: { ...prog, edt, actividades }, movidas, enlaces, descartados };
}

// ---------------------------------------------------------------- line of balance

export interface TramoBalance {
  actividad: string;
  /** Index of its place. */
  ubicacion: number;
  inicio: string;
  fin: string;
  es: number;
  ef: number;
}

export interface TrabajoBalance {
  /** The partida it does (the same work in every place). */
  clave: string;
  nombre: string;
  tramos: TramoBalance[];
}

/**
 * The line of balance: the places (the EDT's work packages that hold
 * activities, preferring those with a location of their own, in the EDT's
 * order) and each kind of work (the partida its activities do) with its
 * dates in each place, to see the crews go up the building.
 */
export function lineaDeBalance(res: Programado): { ubicaciones: { id: string; nombre: string }[]; trabajos: TrabajoBalance[] } {
  const actividades = res.filas.filter((f) => f.tipo === "partida" && f.actividad);
  const conActividades = new Set(actividades.map((f) => f.ancestros[f.ancestros.length - 1]));
  let lugares = res.filas.filter((f) => f.tipo !== "partida" && conActividades.has(f.id));
  const propias = lugares.filter((f) => {
    const padre = f.ancestros[f.ancestros.length - 1];
    return f.ubicacion.length > (padre ? res.porId.get(padre)?.ubicacion.length ?? 0 : 0);
  });
  if (propias.length >= 2) lugares = propias;
  const indice = new Map(lugares.map((f, i) => [f.id, i]));
  const trabajos = new Map<string, TrabajoBalance>();
  for (const f of actividades) {
    const u = indice.get(f.ancestros[f.ancestros.length - 1]);
    if (u === undefined || f.vacia) continue;
    const x = f.asignaciones[0];
    const clave = x ? x.partida : `n:${f.descripcion}`;
    const t = trabajos.get(clave) ?? { clave, nombre: x ? x.item.descripcion : f.descripcion, tramos: [] };
    t.tramos.push({ actividad: f.id, ubicacion: u, inicio: f.inicio, fin: f.fin, es: f.es, ef: f.ef });
    trabajos.set(clave, t);
  }
  let lista = [...trabajos.values()];
  const lugaresDe = (t: TrabajoBalance) => new Set(t.tramos.map((x) => x.ubicacion)).size;
  if (lista.some((t) => lugaresDe(t) >= 2)) lista = lista.filter((t) => lugaresDe(t) >= 2);
  lista.sort((a, b) => Math.min(...a.tramos.map((x) => x.es)) - Math.min(...b.tramos.map((x) => x.es)));
  return { ubicaciones: lugares.map((f) => ({ id: f.id, nombre: f.descripcion })), trabajos: lista };
}
