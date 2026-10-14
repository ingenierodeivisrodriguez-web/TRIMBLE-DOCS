// The schedule (Gantt) built from the budget. Its outline (subpresupuestos,
// titles and partidas) gives the tasks; a partida lasts metrado ÷ (rendimiento
// × cuadrillas) days unless the user typed its duration, and everything is
// scheduled with the critical path method, in working hours of the project's
// calendar (so a 4-hour Saturday is half a day).
import { ApuCalculado, Consumo, consumoDeApu, redondear, Resolver, SubpresupuestoCalculado } from "./calc";
import { Calendario, calendarioPorDefecto, diaSemana, fechaCorta, MESES_CORTOS, sumarDias } from "./calendario";
import type {
  Dependencia,
  ItemPartida,
  PresupuestoDoc,
  Programacion,
  RedondeoDuracion,
  TareaProgramada,
  TipoDependencia,
  TipoInsumo,
} from "./types";
import { MAX_DURACION_DIAS, MAX_PREDECESORAS } from "./types";

const EPS = 1e-6;

export function programacionVacia(inicio: string): Programacion {
  return { inicio, finObjetivo: null, calendario: calendarioPorDefecto(), redondeo: "dia", tareas: {} };
}

export const REDONDEO_NOMBRES: Record<RedondeoDuracion, string> = {
  dia: "Días enteros (hacia arriba)",
  medio: "Medios días (hacia arriba)",
  no: "Sin redondear (2 decimales)",
};

export function redondearDuracion(dias: number, redondeo: RedondeoDuracion): number {
  const x = redondear(dias, 6);
  if (redondeo === "dia") return Math.max(1, Math.ceil(x - EPS));
  if (redondeo === "medio") return Math.max(0.5, Math.ceil(x * 2 - EPS) / 2);
  return Math.max(0.01, redondear(x, 2));
}

/**
 * Working days a partida takes: its metrado ÷ (rendimiento × cuadrillas). The
 * rendimiento is per day of the partida's `jornada` hours; the result is in
 * days of the calendar's jornada. null when it can't be estimated.
 */
export function estimarDuracion(
  p: { metrado: number | null; rendimiento: number; jornada: number },
  cuadrillas: number,
  jornadaCalendario: number,
  redondeo: RedondeoDuracion
): number | null {
  const metrado = p.metrado ?? 0;
  if (!(metrado > 0) || !(p.rendimiento > 0) || !(cuadrillas > 0) || !(jornadaCalendario > 0)) return null;
  const jornada = p.jornada > 0 ? p.jornada : jornadaCalendario;
  return redondearDuracion((metrado / (p.rendimiento * cuadrillas)) * (jornada / jornadaCalendario), redondeo);
}

// ---------------------------------------------------------------- rows

export interface FilaGantt {
  /** The item's id; "sp:<id>" for a subpresupuesto. */
  id: string;
  tipo: "sp" | "titulo" | "partida";
  spId: string;
  /** Row number (from 1): predecessors are written with it. */
  fila: number;
  /** Indentation: 0 for a subpresupuesto. */
  nivel: number;
  /** "1.2.3" ("" for a subpresupuesto). */
  numero: string;
  descripcion: string;
  unidad: string;
  metrado: number | null;
  rendimiento: number | null;
  cu: number | null;
  parcial: number;
  /** The rows that contain it (its subpresupuesto and titles), outermost first. */
  ancestros: string[];
  item: ItemPartida | null;
  /** Working days. */
  duracion: number;
  /** Not typed: it is the estimate. */
  estimada: boolean;
  /** What metrado ÷ (rendimiento × cuadrillas) gives (null if it can't be estimated). */
  estimacion: number | null;
  cuadrillas: number;
  predecesoras: Dependencia[];
  /** "Don't start before" (YYYY-MM-DD). */
  restriccion: string | null;
  /** Early/late start and finish, in working hours from the project's start. */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  inicio: string;
  fin: string;
  /** Total float, in working days. */
  holgura: number;
  critica: boolean;
  /** A title or subpresupuesto without partidas. */
  vacia: boolean;
}

export interface Programado {
  filas: FilaGantt[];
  porId: Map<string, FilaGantt>;
  cal: Calendario;
  inicio: string;
  fin: string;
  /** Working hours and days of the whole project. */
  horas: number;
  dias: number;
  /** Partidas whose predecessors form a loop (those links are ignored). */
  enCiclo: Set<string>;
  avisos: string[];
}

interface Enlace {
  de: string;
  a: string;
  tipo: TipoDependencia;
  /** Hours. */
  desfase: number;
}

/** Strongly connected components (iterative Tarjan): the loops of the graph. */
function componentes(nodos: string[], sucesores: Map<string, string[]>): string[][] {
  let n = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const enPila = new Set<string>();
  const pila: string[] = [];
  const out: string[][] = [];
  for (const raiz of nodos) {
    if (idx.has(raiz)) continue;
    const trabajo: [string, number][] = [[raiz, 0]];
    while (trabajo.length) {
      const top = trabajo[trabajo.length - 1];
      const [v, i] = top;
      if (i === 0 && !idx.has(v)) {
        idx.set(v, n);
        low.set(v, n);
        n++;
        pila.push(v);
        enPila.add(v);
      }
      const ss = sucesores.get(v) ?? [];
      if (i < ss.length) {
        top[1] = i + 1;
        const w = ss[i];
        if (!idx.has(w)) trabajo.push([w, 0]);
        else if (enPila.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        continue;
      }
      trabajo.pop();
      if (trabajo.length) {
        const u = trabajo[trabajo.length - 1][0];
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
      }
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = pila.pop()!;
          enPila.delete(w);
          comp.push(w);
        } while (w !== v);
        out.push(comp);
      }
    }
  }
  return out;
}

export function programar(doc: PresupuestoDoc, calculados: Map<string, SubpresupuestoCalculado>, prog: Programacion): Programado {
  const cal = new Calendario(prog.calendario, prog.inicio);
  const jornada = prog.calendario.jornada;
  const filas: FilaGantt[] = [];
  const vacia = (o: Pick<FilaGantt, "id" | "tipo" | "spId" | "nivel" | "numero" | "descripcion" | "parcial" | "ancestros">): FilaGantt => ({
    ...o,
    fila: 0,
    unidad: "",
    metrado: null,
    rendimiento: null,
    cu: null,
    item: null,
    duracion: 0,
    estimada: false,
    estimacion: null,
    cuadrillas: 0,
    predecesoras: [],
    restriccion: null,
    es: Infinity,
    ef: -Infinity,
    ls: Infinity,
    lf: -Infinity,
    inicio: prog.inicio,
    fin: prog.inicio,
    holgura: Infinity,
    critica: false,
    vacia: true,
  });

  for (const sp of doc.subpresupuestos) {
    const calc = calculados.get(sp.id);
    const spFila = vacia({ id: `sp:${sp.id}`, tipo: "sp", spId: sp.id, nivel: 0, numero: "", descripcion: sp.nombre, parcial: calc?.cd ?? 0, ancestros: [] });
    filas.push(spFila);
    const abiertos: { id: string; nivel: number }[] = [];
    for (const f of calc?.filas ?? []) {
      const item = f.item;
      while (abiertos.length && abiertos[abiertos.length - 1].nivel >= item.nivel) abiertos.pop();
      const ancestros = [spFila.id, ...abiertos.map((t) => t.id)];
      if (item.tipo === "titulo") {
        filas.push(vacia({ id: item.id, tipo: "titulo", spId: sp.id, nivel: item.nivel + 1, numero: f.numero, descripcion: item.descripcion, parcial: f.parcial, ancestros }));
        abiertos.push({ id: item.id, nivel: item.nivel });
        continue;
      }
      const t: TareaProgramada = prog.tareas[item.id] ?? {};
      const cuadrillas = t.cuadrillas && t.cuadrillas > 0 ? t.cuadrillas : 1;
      const estimacion = estimarDuracion({ metrado: f.metrado, rendimiento: item.rendimiento, jornada: item.jornada }, cuadrillas, jornada, prog.redondeo);
      const estimada = t.duracion === undefined;
      filas.push({
        ...vacia({ id: item.id, tipo: "partida", spId: sp.id, nivel: item.nivel + 1, numero: f.numero, descripcion: item.descripcion, parcial: f.parcial, ancestros }),
        unidad: item.unidad,
        metrado: f.metrado,
        rendimiento: item.rendimiento,
        cu: f.cu,
        item,
        duracion: estimada ? estimacion ?? 1 : t.duracion!,
        estimada,
        estimacion,
        cuadrillas,
        predecesoras: t.predecesoras ?? [],
        restriccion: t.inicio ?? null,
        vacia: false,
      });
    }
  }
  filas.forEach((f, i) => (f.fila = i + 1));
  const porId = new Map(filas.map((f) => [f.id, f]));
  const partidas = filas.filter((f) => f.tipo === "partida");
  const avisos: string[] = [];

  // ---- links between partidas (a predecessor that no longer exists is ignored)
  let perdidas = 0;
  const enlaces: Enlace[] = [];
  for (const s of partidas) {
    for (const d of s.predecesoras) {
      const p = porId.get(d.id);
      if (!p || p.tipo !== "partida" || p.id === s.id) {
        perdidas++;
        continue;
      }
      enlaces.push({ de: p.id, a: s.id, tipo: d.tipo, desfase: d.desfase * jornada });
    }
  }
  if (perdidas) avisos.push(`${perdidas} predecesora(s) ya no existen en el presupuesto o no son partidas: se ignoran.`);

  // ---- loops: their links are ignored
  const sucesoresIds = new Map<string, string[]>();
  for (const e of enlaces) sucesoresIds.set(e.de, [...(sucesoresIds.get(e.de) ?? []), e.a]);
  const enCiclo = new Set<string>();
  const compDe = new Map<string, number>();
  componentes(
    partidas.map((p) => p.id),
    sucesoresIds
  ).forEach((comp, k) => {
    for (const id of comp) compDe.set(id, k);
    if (comp.length > 1) for (const id of comp) enCiclo.add(id);
  });
  const validos = enlaces.filter((e) => !(enCiclo.has(e.de) && compDe.get(e.de) === compDe.get(e.a)));
  if (enCiclo.size) {
    const nums = [...enCiclo].map((id) => porId.get(id)!.fila).sort((a, b) => a - b);
    avisos.push(`Las predecesoras de las filas ${nums.join(", ")} forman un ciclo: esos enlaces se ignoran hasta corregirlos.`);
  }

  // ---- topological order (Kahn)
  const entrantes = new Map<string, Enlace[]>();
  const salientes = new Map<string, Enlace[]>();
  for (const e of validos) {
    entrantes.set(e.a, [...(entrantes.get(e.a) ?? []), e]);
    salientes.set(e.de, [...(salientes.get(e.de) ?? []), e]);
  }
  const grado = new Map(partidas.map((p) => [p.id, entrantes.get(p.id)?.length ?? 0]));
  const cola = partidas.filter((p) => grado.get(p.id) === 0).map((p) => p.id);
  const orden: string[] = [];
  for (let i = 0; i < cola.length; i++) {
    const v = cola[i];
    orden.push(v);
    for (const e of salientes.get(v) ?? []) {
      const g = grado.get(e.a)! - 1;
      grado.set(e.a, g);
      if (g === 0) cola.push(e.a);
    }
  }

  // ---- forward pass
  const horas = (f: FilaGantt) => f.duracion * jornada;
  for (const id of orden) {
    const f = porId.get(id)!;
    const d = horas(f);
    let es = f.restriccion ? cal.horaDe(f.restriccion) : 0;
    for (const e of entrantes.get(id) ?? []) {
      const p = porId.get(e.de)!;
      if (e.tipo === "FC") es = Math.max(es, p.ef + e.desfase);
      else if (e.tipo === "CC") es = Math.max(es, p.es + e.desfase);
      else if (e.tipo === "FF") es = Math.max(es, p.ef + e.desfase - d);
      else es = Math.max(es, p.es + e.desfase - d);
    }
    f.es = Math.max(es, 0);
    f.ef = f.es + d;
  }
  const total = partidas.reduce((max, f) => Math.max(max, f.ef), 0);

  // ---- backward pass
  for (let i = orden.length - 1; i >= 0; i--) {
    const f = porId.get(orden[i])!;
    const d = horas(f);
    let lf = total;
    for (const e of salientes.get(f.id) ?? []) {
      const s = porId.get(e.a)!;
      if (e.tipo === "FC") lf = Math.min(lf, s.ls - e.desfase);
      else if (e.tipo === "CC") lf = Math.min(lf, s.ls - e.desfase + d);
      else if (e.tipo === "FF") lf = Math.min(lf, s.lf - e.desfase);
      else lf = Math.min(lf, s.lf - e.desfase + d);
    }
    f.lf = lf;
    f.ls = lf - d;
  }

  // ---- dates, float, and the rows that contain them
  for (const f of partidas) {
    f.holgura = redondear((f.ls - f.es) / jornada, 2);
    f.critica = f.ls - f.es <= EPS;
    f.inicio = cal.fechaInicio(f.es);
    f.fin = f.ef > f.es ? cal.fechaFin(f.ef) : cal.fechaFin(f.es);
    for (const a of f.ancestros) {
      const t = porId.get(a)!;
      t.vacia = false;
      t.es = Math.min(t.es, f.es);
      t.ef = Math.max(t.ef, f.ef);
      t.ls = Math.min(t.ls, f.ls);
      t.lf = Math.max(t.lf, f.lf);
      t.holgura = Math.min(t.holgura, f.holgura);
      t.critica = t.critica || f.critica;
    }
  }
  for (const t of filas) {
    if (t.tipo === "partida") continue;
    if (t.vacia) {
      t.es = t.ef = t.ls = t.lf = 0;
      t.holgura = 0;
      continue;
    }
    t.duracion = redondear((t.ef - t.es) / jornada, 2);
    t.inicio = cal.fechaInicio(t.es);
    t.fin = t.ef > t.es ? cal.fechaFin(t.ef) : cal.fechaFin(t.es);
  }

  const inicio = cal.fechaInicio(0);
  const fin = total > 0 ? cal.fechaFin(total) : inicio;
  if (prog.finObjetivo && fin > prog.finObjetivo) {
    avisos.push(`El proyecto termina el ${fechaCorta(fin)}, después de la fecha fin (${fechaCorta(prog.finObjetivo)}).`);
  }
  return { filas, porId, cal, inicio, fin, horas: total, dias: redondear(total / jornada, 2), enCiclo, avisos };
}

// ---------------------------------------------------------------- predecessors as text ("4; 6CC+2; 9FF-1")

const TIPOS_TEXTO: Record<string, TipoDependencia> = { FC: "FC", CC: "CC", FF: "FF", CF: "CF", FS: "FC", SS: "CC", SF: "CF" };

function numeroTexto(n: number): string {
  return String(redondear(n, 2)).replace(".", ",");
}

export function textoDependencia(d: Dependencia, fila: number): string {
  const desfase = d.desfase ? `${d.desfase > 0 ? "+" : "-"}${numeroTexto(Math.abs(d.desfase))}` : "";
  return `${fila}${d.tipo === "FC" && !desfase ? "" : d.tipo}${desfase}`;
}

export function textoPredecesoras(deps: Dependencia[], filaDe: (id: string) => number | undefined): string {
  return deps
    .map((d) => {
      const n = filaDe(d.id);
      return n === undefined ? null : textoDependencia(d, n);
    })
    .filter(Boolean)
    .join("; ");
}

/** Whether `itemId` having these predecessors makes a loop with the other links. */
export function creaCiclo(tareas: Record<string, TareaProgramada>, itemId: string, predecesoras: string[]): boolean {
  const sucesores = new Map<string, string[]>();
  for (const [id, t] of Object.entries(tareas)) {
    if (id === itemId) continue;
    for (const d of t.predecesoras ?? []) sucesores.set(d.id, [...(sucesores.get(d.id) ?? []), id]);
  }
  const objetivo = new Set(predecesoras);
  if (objetivo.has(itemId)) return true;
  const vistos = new Set<string>([itemId]);
  const pila = [itemId];
  while (pila.length) {
    for (const s of sucesores.get(pila.pop()!) ?? []) {
      if (objetivo.has(s)) return true;
      if (!vistos.has(s)) {
        vistos.add(s);
        pila.push(s);
      }
    }
  }
  return false;
}

/**
 * Reads what the user typed in the Predecesoras column: row numbers, each
 * with an optional type (FC, CC, FF, CF; also FS, SS, SF) and a lag in
 * working days ("+2", or "-1" to start in advance), separated by ";" or ",".
 */
export function leerPredecesoras(
  texto: string,
  p: Pick<Programado, "filas">,
  itemId: string,
  tareas: Record<string, TareaProgramada>
): { deps: Dependencia[] } | { error: string } {
  const deps: Dependencia[] = [];
  const re = /(\d+)\s*([A-Za-z]{2})?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*(?:d[ií]as?|d)?)?/y;
  let pos = 0;
  const t = texto.trim();
  while (pos < t.length) {
    const sep = /[\s;,]*/y;
    sep.lastIndex = pos;
    sep.exec(t);
    pos = sep.lastIndex;
    if (pos >= t.length) break;
    re.lastIndex = pos;
    const m = re.exec(t);
    if (!m || m[0].length === 0) return { error: `No se entiende «${t.slice(pos, pos + 12)}». Escribe filas como 4, 6CC+2 o 9FF-1, separadas por ";".` };
    pos = re.lastIndex;
    const fila = p.filas[Number(m[1]) - 1];
    if (!fila) return { error: `No existe la fila ${m[1]}.` };
    if (fila.tipo !== "partida") return { error: `La fila ${m[1]} es un ${fila.tipo === "sp" ? "subpresupuesto" : "título"}: enlaza una de sus partidas.` };
    if (fila.id === itemId) return { error: "Una partida no puede ser su propia predecesora." };
    const tipo = m[2] ? TIPOS_TEXTO[m[2].toUpperCase()] : "FC";
    if (!tipo) return { error: `«${m[2]}» no es un tipo de enlace: usa FC, CC, FF o CF.` };
    const desfase = m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4].replace(",", ".")) : 0;
    if (Math.abs(desfase) > MAX_DURACION_DIAS) return { error: `El desfase de la fila ${m[1]} es demasiado grande.` };
    if (deps.some((d) => d.id === fila.id)) return { error: `La fila ${m[1]} está repetida.` };
    deps.push({ id: fila.id, tipo, desfase: redondear(desfase, 2) });
  }
  if (deps.length > MAX_PREDECESORAS) return { error: `Máximo ${MAX_PREDECESORAS} predecesoras por partida.` };
  if (creaCiclo(tareas, itemId, deps.map((d) => d.id))) return { error: "Esas predecesoras forman un ciclo: una de ellas ya depende de esta partida." };
  return { deps };
}

// ---------------------------------------------------------------- money over time

export type TipoPeriodo = "semana" | "mes";

export interface Periodo {
  desde: string;
  hasta: string;
  etiqueta: string;
  /** Working hours from the project's start at its beginning and end. */
  h0: number;
  h1: number;
}

/** Weeks (Monday to Sunday) or months from the project's start to its end. */
export function periodos(p: Pick<Programado, "cal" | "inicio" | "fin">, tipo: TipoPeriodo): Periodo[] {
  const out: Periodo[] = [];
  let desde = tipo === "mes" ? `${p.inicio.slice(0, 7)}-01` : sumarDias(p.inicio, -diaSemana(p.inicio));
  for (let n = 1; desde <= p.fin && n <= 3000; n++) {
    let siguiente: string;
    let etiqueta: string;
    if (tipo === "mes") {
      const y = +desde.slice(0, 4);
      const m = +desde.slice(5, 7);
      siguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      etiqueta = `${MESES_CORTOS[m - 1]}-${y}`;
    } else {
      siguiente = sumarDias(desde, 7);
      etiqueta = `Sem ${n} (${fechaCorta(desde).slice(0, 5)})`;
    }
    out.push({ desde, hasta: sumarDias(siguiente, -1), etiqueta, h0: p.cal.horaDe(desde), h1: p.cal.horaDe(siguiente) });
    desde = siguiente;
  }
  return out;
}

/** The share of a task's work done in each period. */
export function fracciones(f: Pick<FilaGantt, "es" | "ef">, per: Periodo[]): number[] {
  const d = f.ef - f.es;
  if (d <= EPS) {
    let k = per.findIndex((x) => f.es < x.h1);
    if (k < 0) k = per.length - 1;
    return per.map((_, i) => (i === k ? 1 : 0));
  }
  return per.map((x) => Math.max(0, Math.min(f.ef, x.h1) - Math.max(f.es, x.h0)) / d);
}

/** Splits an amount by shares, to cents, so the parts add up exactly to it. */
export function repartir(total: number, partes: number[], decimales = 2): number[] {
  const suma = partes.reduce((a, b) => a + b, 0);
  if (partes.length === 0) return [];
  const crudo = partes.map((x) => (suma > 0 ? (total * x) / suma : 0));
  const out = crudo.map((x) => redondear(x, decimales));
  const diff = redondear(total - out.reduce((a, b) => a + b, 0), decimales);
  if (diff !== 0) {
    let k = 0;
    crudo.forEach((x, i) => {
      if (Math.abs(x) > Math.abs(crudo[k])) k = i;
    });
    out[k] = redondear(out[k] + diff, decimales);
  }
  return out;
}

function enAlcance(f: FilaGantt, spId: string | null) {
  return spId === null || f.spId === spId;
}

export interface FilaValorizada {
  fila: FilaGantt;
  montos: number[];
}

export interface CalendarioValorizado {
  periodos: Periodo[];
  filas: FilaValorizada[];
  totales: number[];
  total: number;
  /** Each period's share of the total, in %. */
  porcentajes: number[];
}

/** Each item's amount spread over the periods its work falls in (titles add up their partidas). */
export function calendarioValorizado(p: Programado, spId: string | null, tipo: TipoPeriodo = "mes"): CalendarioValorizado {
  const per = periodos(p, tipo);
  const montos = new Map<string, number[]>();
  for (const f of p.filas) {
    if (f.tipo !== "partida" || !enAlcance(f, spId)) continue;
    const m = repartir(f.parcial, fracciones(f, per));
    montos.set(f.id, m);
    for (const a of f.ancestros) {
      const acc = montos.get(a) ?? per.map(() => 0);
      m.forEach((v, i) => (acc[i] += v));
      montos.set(a, acc);
    }
  }
  const filas: FilaValorizada[] = p.filas
    .filter((f) => enAlcance(f, spId) && !(spId !== null && f.tipo === "sp"))
    .map((f) => ({ fila: f, montos: (montos.get(f.id) ?? per.map(() => 0)).map((v) => redondear(v, 2)) }));
  const totales = per.map((_, i) => redondear(filas.filter((x) => x.fila.tipo === "partida").reduce((sum, x) => sum + x.montos[i], 0), 2));
  const total = redondear(totales.reduce((a, b) => a + b, 0), 2);
  return { periodos: per, filas, totales, total, porcentajes: totales.map((t) => (total ? redondear((t / total) * 100, 3) : 0)) };
}

export interface CurvaS {
  periodos: Periodo[];
  montos: number[];
  acumulado: number[];
  /** Cumulative % of the total. */
  porcentaje: number[];
  total: number;
}

export function curvaS(p: Programado, tipo: TipoPeriodo, spId: string | null = null): CurvaS {
  const cv = calendarioValorizado(p, spId, tipo);
  let acc = 0;
  const acumulado = cv.totales.map((t) => (acc = redondear(acc + t, 2)));
  return {
    periodos: cv.periodos,
    montos: cv.totales,
    acumulado,
    porcentaje: acumulado.map((a) => (cv.total ? redondear((a / cv.total) * 100, 2) : 0)),
    total: cv.total,
  };
}

export interface FilaInsumoPeriodo {
  id: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  /** A "%MO" resource: its amounts are money, not quantities. */
  porcentajeMO: boolean;
  cantidad: number;
  precio: number;
  parcial: number;
  cantidades: number[];
  montos: number[];
}

const ORDEN_TIPO: Record<TipoInsumo, number> = { MO: 0, MT: 1, EQ: 2, SC: 3 };

/** Each resource's quantity and cost spread over the periods, following the partidas that use it. */
export function calendarioInsumos(p: Programado, r: Resolver, spId: string | null, tipo: TipoPeriodo = "mes"): { periodos: Periodo[]; filas: FilaInsumoPeriodo[]; totales: number[]; total: number } {
  const per = periodos(p, tipo);
  const cache = new Map<string, ApuCalculado>();
  const cantidades = new Map<string, number[]>();
  const montos = new Map<string, number[]>();
  const sumar = (mapa: Map<string, number[]>, id: string, valor: number, fr: number[]) => {
    const acc = mapa.get(id) ?? per.map(() => 0);
    fr.forEach((x, i) => (acc[i] += valor * x));
    mapa.set(id, acc);
  };
  for (const f of p.filas) {
    if (f.tipo !== "partida" || !f.item || !enAlcance(f, spId) || !f.metrado) continue;
    const fr = fracciones(f, per);
    const consumo: Consumo = consumoDeApu(f.item, f.metrado, r, cache);
    for (const [id, q] of consumo.cantidades) sumar(cantidades, id, q, fr);
    for (const [id, m] of consumo.montos) sumar(montos, id, m, fr);
  }
  const filas: FilaInsumoPeriodo[] = [];
  for (const [id, qs] of cantidades) {
    const ins = r.insumo(id);
    if (!ins) continue;
    const cantidad = redondear(
      qs.reduce((a, b) => a + b, 0),
      4
    );
    const parcial = redondear(cantidad * ins.precio, 2);
    filas.push({
      id,
      descripcion: ins.descripcion,
      unidad: ins.unidad,
      tipo: ins.tipo,
      porcentajeMO: false,
      cantidad,
      precio: ins.precio,
      parcial,
      cantidades: repartir(cantidad, qs, 4),
      montos: repartir(parcial, qs),
    });
  }
  for (const [id, ms] of montos) {
    const ins = r.insumo(id);
    if (!ins) continue;
    const parcial = redondear(
      ms.reduce((a, b) => a + b, 0),
      2
    );
    filas.push({ id, descripcion: ins.descripcion, unidad: ins.unidad, tipo: ins.tipo, porcentajeMO: true, cantidad: 0, precio: 0, parcial, cantidades: per.map(() => 0), montos: repartir(parcial, ms) });
  }
  filas.sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || a.descripcion.localeCompare(b.descripcion, "es", { sensitivity: "base" }));
  const totales = per.map((_, i) => redondear(filas.reduce((sum, f) => sum + f.montos[i], 0), 2));
  return { periodos: per, filas, totales, total: redondear(totales.reduce((a, b) => a + b, 0), 2) };
}
