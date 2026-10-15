// Progress against the approved schedule (earned value). The baseline freezes
// the schedule's dates and planned costs; each progress report (corte) gives
// every partida's cumulative % and, when recorded, its actual cost. From them
// come the planned value (PV), the earned value (EV) and the actual cost (AC),
// and the indicators that tell whether the work is ahead or behind, in time
// (SPI, earned schedule) and in cost (CPI).
import { redondear, SubpresupuestoCalculado } from "./calc";
import { Calendario, sumarDias } from "./calendario";
import { FilaGantt, periodos, Periodo, Programado, TipoPeriodo } from "./programacion";
import type { CorteAvance, EjecucionItem, FiltroUbicacion, LineaBaseDatos, Memoria, PresupuestoDoc, Programacion, TareaBase } from "./types";
import { SIN_DATO_UBICACION } from "./types";

const EPS = 1e-9;

/** A schedule row as a baseline row (what a task does of each partida, where, and who answers for a node). */
export function tareaBaseDe(f: FilaGantt): TareaBase {
  return {
    id: f.id,
    tipo: f.tipo,
    spId: f.spId,
    nivel: f.nivel,
    numero: f.numero,
    descripcion: f.descripcion,
    unidad: f.unidad,
    ancestros: f.ancestros,
    metrado: f.metrado,
    costo: redondear(f.parcial, 2),
    es: redondear(f.es, 4),
    ef: redondear(f.ef, 4),
    inicio: f.inicio,
    fin: f.fin,
    duracion: f.duracion,
    ...(f.tipo === "partida" ? { asignaciones: f.asignaciones.map((a) => ({ partida: a.partida, pct: a.pct, costo: a.parcial })) } : {}),
    ...(f.responsable ? { responsable: f.responsable } : {}),
    ...(f.tipo === "partida" && f.ubicacion.length ? { ubicacion: f.ubicacion } : {}),
  };
}

/** The schedule on screen, frozen as a baseline. */
export function lineaBaseDe(res: Programado, prog: Programacion): LineaBaseDatos {
  const tareas = res.filas.filter((f) => !f.vacia).map(tareaBaseDe);
  const total = redondear(
    tareas.filter((t) => t.tipo === "partida").reduce((s, t) => s + t.costo, 0),
    2
  );
  return { calendarioInicio: prog.inicio, calendario: prog.calendario, inicio: res.inicio, fin: res.fin, total, tareas };
}

/** The share of a baseline task planned to be done after `h` working hours. */
export function fraccionPlaneada(t: Pick<TareaBase, "es" | "ef">, h: number): number {
  if (t.ef - t.es <= EPS) return h > t.es ? 1 : 0;
  return Math.min(Math.max((h - t.es) / (t.ef - t.es), 0), 1);
}

/** Measures against a baseline: its calendar, its partidas and their planned value over time. */
export class Medidor {
  readonly cal: Calendario;
  readonly partidas: TareaBase[];
  readonly porId: Map<string, TareaBase>;
  readonly jornada: number;

  constructor(readonly base: LineaBaseDatos) {
    this.cal = new Calendario(base.calendario, base.calendarioInicio);
    this.partidas = base.tareas.filter((t) => t.tipo === "partida");
    this.porId = new Map(base.tareas.map((t) => [t.id, t]));
    this.jornada = base.calendario.jornada || 8;
  }

  /** Working hours done by the end of a date. */
  hora(fecha: string): number {
    return this.cal.horaDe(sumarDias(fecha, 1));
  }

  /** The baseline's planned value after `h` hours. */
  pv(h: number, partidas: TareaBase[] = this.partidas): number {
    return partidas.reduce((s, t) => s + t.costo * fraccionPlaneada(t, h), 0);
  }

  /**
   * When the baseline planned to have earned `ev` (the earned schedule), in hours. Where the
   * planned value stays flat (nothing planned for a while), the time closest to `h` (the cut)
   * counts: work not due yet is not late.
   */
  horaGanada(ev: number, h: number, partidas: TareaBase[] = this.partidas): number {
    const fin = partidas.reduce((m, t) => Math.max(m, t.ef), 0);
    /** The first hour in [0, fin] where `cumple` holds (it holds from there on). */
    const primera = (cumple: (t: number) => boolean) => {
      if (!cumple(fin)) return fin;
      let lo = 0;
      let hi = fin;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (cumple(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    const desde = ev <= EPS ? 0 : primera((t) => this.pv(t, partidas) >= ev - 1e-6);
    const hasta = primera((t) => this.pv(t, partidas) > ev + 1e-6);
    return Math.min(Math.max(h, desde), hasta);
  }

  /** The day the `h`-th working hour falls on. */
  fechaDeHora(h: number): string {
    return h <= 0 ? this.cal.fechaInicio(0) : this.cal.fechaFin(h);
  }

  /** The partidas of a row: itself, or those it contains. */
  partidasDe(id: string | null): TareaBase[] {
    if (id === null) return this.partidas;
    const t = this.porId.get(id);
    if (!t) return [];
    return t.tipo === "partida" ? [t] : this.partidas.filter((p) => p.ancestros.includes(id));
  }
}

export interface Indicadores {
  fecha: string;
  /** Budget at completion (planned cost). */
  bac: number;
  pv: number;
  ev: number;
  /** Actual cost of the partidas that have it recorded (null: none). */
  ac: number | null;
  /** % of the planned cost planned and earned by the date. */
  pctPlaneado: number;
  pctReal: number;
  /** EV − PV, and EV ÷ PV. */
  sv: number;
  spi: number | null;
  /** On the partidas with actual cost: EV − AC, and EV ÷ AC. */
  cv: number | null;
  cpi: number | null;
  /** Estimate at completion at the current cost efficiency (BAC ÷ CPI), and BAC − EAC. */
  eac: number | null;
  vac: number | null;
  /** Earned schedule minus time elapsed, in working days: negative is behind. */
  svDias: number | null;
  spiT: number | null;
  /** The finish date at the current pace (when it is all done: the cut's date, it finished by then). */
  finEstimado: string | null;
  /** All of it is done. */
  terminada: boolean;
  /** Partidas with progress, and with actual cost recorded. */
  conAvance: number;
  conCosto: number;
}

const avanceDe = (corte: CorteAvance | null, id: string) => corte?.partidas[id];

/** The earned-value indicators of a cut (of the whole baseline, or of a row and what it contains). */
export function indicadores(m: Medidor, corte: CorteAvance, alcance: string | null = null): Indicadores {
  const partidas = m.partidasDe(alcance);
  const h = m.hora(corte.fecha);
  let bac = 0;
  let pv = 0;
  let ev = 0;
  let ac = 0;
  let evConCosto = 0;
  let conAvance = 0;
  let conCosto = 0;
  for (const t of partidas) {
    const a = avanceDe(corte, t.id);
    const e = (t.costo * (a?.pct ?? 0)) / 100;
    bac += t.costo;
    pv += t.costo * fraccionPlaneada(t, h);
    ev += e;
    if (a && a.pct > 0) conAvance++;
    if (a?.costo !== undefined) {
      conCosto++;
      ac += a.costo;
      evConCosto += e;
    }
  }
  const cpi = conCosto && ac > EPS ? evConCosto / ac : null;
  const eac = cpi && cpi > EPS ? bac / cpi : null;
  // Earned schedule: when the baseline planned to have earned what was earned, counted from
  // when the row was planned to start. Once all is done, it finished by the cut.
  const terminada = bac > EPS && ev >= bac - 0.005;
  let svDias: number | null = null;
  let spiT: number | null = null;
  let finEstimado: string | null = terminada ? corte.fecha : null;
  if (partidas.length && !terminada) {
    const s0 = partidas.reduce((x, t) => Math.min(x, t.es), Infinity);
    const fin = partidas.reduce((x, t) => Math.max(x, t.ef), 0);
    const es = m.horaGanada(ev, h, partidas);
    svDias = redondear((es - h) / m.jornada, 1);
    if (h - s0 > EPS) {
      spiT = (es - s0) / (h - s0);
      if (spiT > EPS) finEstimado = m.fechaDeHora(s0 + (fin - s0) / spiT);
    }
  }
  return {
    fecha: corte.fecha,
    bac: redondear(bac, 2),
    pv: redondear(pv, 2),
    ev: redondear(ev, 2),
    ac: conCosto ? redondear(ac, 2) : null,
    pctPlaneado: bac > EPS ? redondear((pv / bac) * 100, 2) : 0,
    pctReal: bac > EPS ? redondear((ev / bac) * 100, 2) : 0,
    sv: redondear(ev - pv, 2),
    spi: pv > EPS ? redondear(ev / pv, 3) : null,
    cv: conCosto ? redondear(evConCosto - ac, 2) : null,
    cpi: cpi === null ? null : redondear(cpi, 3),
    eac: eac === null ? null : redondear(eac, 2),
    vac: eac === null ? null : redondear(bac - eac, 2),
    svDias: svDias === 0 ? 0 : svDias,
    spiT: spiT === null ? null : redondear(spiT, 3),
    terminada,
    finEstimado,
    conAvance,
    conCosto,
  };
}

export type EstadoAvance = "sin-iniciar" | "atrasada" | "al-dia" | "adelantada" | "terminada";
export const ESTADO_AVANCE: Record<EstadoAvance, { texto: string; color: string; fondo: string }> = {
  "sin-iniciar": { texto: "Sin iniciar", color: "#5f6368", fondo: "#f1f3f4" },
  atrasada: { texto: "Atrasada", color: "#8a1c14", fondo: "#fdecea" },
  "al-dia": { texto: "Al día", color: "#1e6b2e", fondo: "#e3f4e6" },
  adelantada: { texto: "Adelantada", color: "#0b57d0", fondo: "#e8f0fe" },
  terminada: { texto: "Terminada", color: "#1e6b2e", fondo: "#cdebd3" },
};

/** Ahead, behind or on time: the % done against the % planned, with half a point of margin. */
export function estadoAvance(pctPlaneado: number, pctReal: number): EstadoAvance {
  if (pctReal >= 100 - EPS) return "terminada";
  if (pctPlaneado <= EPS && pctReal <= EPS) return "sin-iniciar";
  if (pctReal > pctPlaneado + 0.5) return "adelantada";
  if (pctReal < pctPlaneado - 0.5) return "atrasada";
  return "al-dia";
}

export interface FilaControl {
  tarea: TareaBase;
  bac: number;
  pv: number;
  ev: number;
  ac: number | null;
  pctPlaneado: number;
  pctReal: number;
  spi: number | null;
  cpi: number | null;
  estado: EstadoAvance;
}

/** Every row of the baseline at a cut: partidas, and the titles and subpresupuestos adding up theirs. */
export function filasControl(m: Medidor, corte: CorteAvance): FilaControl[] {
  const h = m.hora(corte.fecha);
  const suma = new Map<string, { bac: number; pv: number; ev: number; ac: number; evC: number; conCosto: number }>();
  const agregar = (id: string, x: { bac: number; pv: number; ev: number; ac: number; evC: number; conCosto: number }) => {
    const s = suma.get(id) ?? { bac: 0, pv: 0, ev: 0, ac: 0, evC: 0, conCosto: 0 };
    s.bac += x.bac;
    s.pv += x.pv;
    s.ev += x.ev;
    s.ac += x.ac;
    s.evC += x.evC;
    s.conCosto += x.conCosto;
    suma.set(id, s);
  };
  for (const t of m.partidas) {
    const a = avanceDe(corte, t.id);
    const ev = (t.costo * (a?.pct ?? 0)) / 100;
    const x = { bac: t.costo, pv: t.costo * fraccionPlaneada(t, h), ev, ac: a?.costo ?? 0, evC: a?.costo !== undefined ? ev : 0, conCosto: a?.costo !== undefined ? 1 : 0 };
    agregar(t.id, x);
    for (const anc of t.ancestros) agregar(anc, x);
  }
  return m.base.tareas.map((tarea) => {
    const s = suma.get(tarea.id) ?? { bac: 0, pv: 0, ev: 0, ac: 0, evC: 0, conCosto: 0 };
    const pctPlaneado = s.bac > EPS ? redondear((s.pv / s.bac) * 100, 2) : 0;
    const pctReal = s.bac > EPS ? redondear((s.ev / s.bac) * 100, 2) : tarea.tipo === "partida" ? avanceDe(corte, tarea.id)?.pct ?? 0 : 0;
    return {
      tarea,
      bac: redondear(s.bac, 2),
      pv: redondear(s.pv, 2),
      ev: redondear(s.ev, 2),
      ac: s.conCosto ? redondear(s.ac, 2) : null,
      pctPlaneado,
      pctReal,
      spi: s.pv > EPS ? redondear(s.ev / s.pv, 3) : null,
      cpi: s.conCosto && s.ac > EPS ? redondear(s.evC / s.ac, 3) : null,
      estado: estadoAvance(pctPlaneado, pctReal),
    };
  });
}

export interface PuntoValorGanado {
  periodo: Periodo;
  /** Cumulative, at the end of the period. */
  pv: number;
  /** Of the last cut by the end of the period (null: no cut yet, or after the last one). */
  ev: number | null;
  ac: number | null;
}

export interface CurvaValorGanado {
  puntos: PuntoValorGanado[];
  bac: number;
}

/** PV over the baseline's periods, with EV and AC of the cuts (each period shows its last cut). */
export function curvaValorGanado(m: Medidor, cortes: CorteAvance[], tipo: TipoPeriodo, alcance: string | null = null): CurvaValorGanado {
  const partidas = m.partidasDe(alcance);
  const ordenados = [...cortes].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = ordenados.length ? ordenados[ordenados.length - 1].fecha : null;
  const fin = ultimo && ultimo > m.base.fin ? ultimo : m.base.fin;
  const per = periodos({ cal: m.cal, inicio: m.base.inicio, fin }, tipo);
  const bac = redondear(
    partidas.reduce((s, t) => s + t.costo, 0),
    2
  );
  const puntos = per.map((p): PuntoValorGanado => {
    const pv = redondear(m.pv(m.hora(p.hasta), partidas), 2);
    let corte: CorteAvance | null = null;
    for (const c of ordenados) if (c.fecha <= p.hasta) corte = c;
    if (!corte || (ultimo && p.desde > ultimo)) return { periodo: p, pv, ev: null, ac: null };
    const ind = indicadores(m, corte, alcance);
    return { periodo: p, pv, ev: ind.ev, ac: ind.ac };
  });
  return { puntos, bac };
}

/** The % of a partida built according to its elements marked in the viewer (by quantity, or by count when they aren't measured). */
export function pctDelModelo(e: EjecucionItem | undefined): number | null {
  if (!e || e.elementos === 0) return null;
  const pct = e.suma > EPS ? (e.sumaEjecutada / e.suma) * 100 : (e.ejecutados / e.elementos) * 100;
  return redondear(Math.min(Math.max(pct, 0), 100), 2);
}

/** A new cut at a date, starting from what the previous one had (progress and cost are cumulative). */
export function nuevoCorte(id: string, fecha: string, anterior: CorteAvance | null): CorteAvance {
  return { id, fecha, nota: "", partidas: anterior ? structuredClone(anterior.partidas) : {} };
}

/** The cut before a date (or null). */
export function corteAnterior(cortes: CorteAvance[], fecha: string): CorteAvance | null {
  let out: CorteAvance | null = null;
  for (const c of cortes) if (c.fecha < fecha && (!out || c.fecha > out.fecha)) out = c;
  return out;
}

/** A plain-language reading of the indicators. */
export function lecturaIndicadores(i: Indicadores): string[] {
  const out: string[] = [];
  if (i.terminada) out.push(`Todo lo de la línea base está ejecutado (a más tardar el ${i.fecha.split("-").reverse().join("-")}).`);
  else if (i.svDias !== null && (i.pv > EPS || i.ev > EPS)) {
    const d = Math.abs(i.svDias);
    out.push(
      i.svDias < -0.5
        ? `En plazo, la obra va atrasada: lo ejecutado se había previsto ${d.toLocaleString("es-CO")} día(s) hábil(es) antes (SPI ${i.spi?.toLocaleString("es-CO")}).`
        : i.svDias > 0.5
          ? `En plazo, la obra va adelantada ${d.toLocaleString("es-CO")} día(s) hábil(es) (SPI ${i.spi?.toLocaleString("es-CO")}).`
          : "En plazo, la obra va al día."
    );
  }
  if (i.cpi !== null) {
    out.push(
      i.cpi < 0.98
        ? `En costo, se está gastando más de lo previsto por lo ejecutado (CPI ${i.cpi.toLocaleString("es-CO")}).`
        : i.cpi > 1.02
          ? `En costo, se está gastando menos de lo previsto por lo ejecutado (CPI ${i.cpi.toLocaleString("es-CO")}).`
          : "En costo, el gasto va de acuerdo con lo ejecutado."
    );
  } else {
    out.push("Para saber cómo va en costo, registra el costo real de las partidas con avance.");
  }
  return out;
}

// ---------------------------------------------------------------- the model, colored by progress

export type EstadoElemento = "ejecutado" | "atrasado" | "en-curso" | "pendiente";
export const ESTADO_ELEMENTO: Record<EstadoElemento, { texto: string; color: string }> = {
  ejecutado: { texto: "Ejecutado", color: "#2e8540" },
  atrasado: { texto: "Pendiente y atrasado (su partida debía terminar)", color: "#d93025" },
  "en-curso": { texto: "Pendiente, su partida está en ejecución según la línea base", color: "#f2a900" },
  pendiente: { texto: "Pendiente, todavía no le toca", color: "#b0b6be" },
};
const PESO: Record<EstadoElemento, number> = { ejecutado: 0, pendiente: 1, "en-curso": 2, atrasado: 3 };

/** What a baseline task does of each partida (a task of the budget's outline is its partida, all of it). */
export function asignacionesDe(t: TareaBase): { partida: string; pct: number; costo: number }[] {
  return t.asignaciones ?? (t.tipo === "partida" ? [{ partida: t.id, pct: 100, costo: t.costo }] : []);
}

const normal = (x: string) => x.trim().toUpperCase();

/** Whether an element is in a place: each filter's column has its value ("(sin dato)": has none). */
export function cumpleUbicacion(memoria: Memoria | null | undefined, filtros: FiltroUbicacion[] | undefined): boolean {
  return (filtros ?? []).every((f) => {
    const v = normal(memoria?.[f.columna] ?? "");
    return f.valor === SIN_DATO_UBICACION ? v === "" : v === normal(f.valor);
  });
}

export type ElementoAvance = { itemId: string; ifcGuid: string; modelId: string; cantidad?: number | null; ejecutado?: string | null; memoria?: Memoria | null };

/**
 * A task's % built by a date according to the viewer: for each partida it
 * does, its elements in the task's place built by then (by measured
 * quantity, or by count), weighted by the task's cost of each partida.
 * null when none of its partidas has elements there.
 */
export function pctTareaDelModelo(t: TareaBase, porPartida: Map<string, ElementoAvance[]>, fecha: string): number | null {
  let peso = 0;
  let hecho = 0;
  for (const a of asignacionesDe(t)) {
    const els = (porPartida.get(a.partida) ?? []).filter((e) => cumpleUbicacion(e.memoria, t.ubicacion));
    if (!els.length) continue;
    const porCantidad = els.some((e) => (e.cantidad ?? 0) > 0);
    let total = 0;
    let ejecutado = 0;
    for (const e of els) {
      const w = porCantidad ? e.cantidad ?? 0 : 1;
      total += w;
      if (e.ejecutado && e.ejecutado <= fecha) ejecutado += w;
    }
    if (!(total > 0)) continue;
    const w = a.costo > 0 ? a.costo : 1;
    peso += w;
    hecho += (w * ejecutado) / total;
  }
  return peso > 0 ? redondear(Math.min((hecho / peso) * 100, 100), 2) : null;
}

/**
 * Each element's state at a date: built for all its partidas, or pending,
 * and then late (the baseline task that does it there should have finished),
 * in progress (that task was planned to be under way) or not due yet. The
 * task is found by the element's partida and place. An element of several
 * partidas takes the worst of them.
 */
export function estadoElementos(elementos: ElementoAvance[], fecha: string, base: LineaBaseDatos | null): Map<string, { estado: EstadoElemento; modelId: string }> {
  const porPartida = new Map<string, TareaBase[]>();
  for (const t of base?.tareas ?? []) {
    if (t.tipo !== "partida") continue;
    for (const a of asignacionesDe(t)) porPartida.set(a.partida, [...(porPartida.get(a.partida) ?? []), t]);
  }
  const out = new Map<string, { estado: EstadoElemento; modelId: string }>();
  for (const e of elementos) {
    let estado: EstadoElemento = "ejecutado";
    if (!e.ejecutado || e.ejecutado > fecha) {
      estado = "pendiente";
      for (const t of porPartida.get(e.itemId) ?? []) {
        if (!cumpleUbicacion(e.memoria, t.ubicacion)) continue;
        const x: EstadoElemento = t.fin <= fecha ? "atrasado" : t.inicio <= fecha ? "en-curso" : "pendiente";
        if (PESO[x] > PESO[estado]) estado = x;
      }
    }
    const antes = out.get(e.ifcGuid);
    if (!antes || PESO[estado] > PESO[antes.estado]) out.set(e.ifcGuid, { estado, modelId: e.modelId });
  }
  return out;
}

// ---------------------------------------------------------------- the same earned value, by the budget and by control account

/** A row of the budget's outline (cost breakdown): a subpresupuesto, a title or a partida. */
export interface FilaEstructura {
  id: string;
  tipo: "sp" | "titulo" | "partida";
  numero: string;
  descripcion: string;
  nivel: number;
  ancestros: string[];
}

/** The budget's outline as it is now, to show the earned value by its chapters. */
export function estructuraPresupuesto(doc: PresupuestoDoc, calculados: Map<string, SubpresupuestoCalculado>): FilaEstructura[] {
  const out: FilaEstructura[] = [];
  for (const sp of doc.subpresupuestos) {
    const spId = `sp:${sp.id}`;
    out.push({ id: spId, tipo: "sp", numero: "", descripcion: sp.nombre, nivel: 0, ancestros: [] });
    const abiertos: { id: string; nivel: number }[] = [];
    for (const f of calculados.get(sp.id)?.filas ?? []) {
      while (abiertos.length && abiertos[abiertos.length - 1].nivel >= f.item.nivel) abiertos.pop();
      out.push({ id: f.item.id, tipo: f.item.tipo, numero: f.numero, descripcion: f.item.descripcion, nivel: f.item.nivel + 1, ancestros: [spId, ...abiertos.map((a) => a.id)] });
      if (f.item.tipo === "titulo") abiertos.push({ id: f.item.id, nivel: f.item.nivel });
    }
  }
  return out;
}

export interface FilaAgrupada {
  id: string;
  tipo: "sp" | "titulo" | "partida" | "cuenta";
  numero: string;
  descripcion: string;
  nivel: number;
  responsable: string;
  bac: number;
  pv: number;
  ev: number;
  ac: number | null;
  pctPlaneado: number;
  pctReal: number;
  spi: number | null;
  cpi: number | null;
  estado: EstadoAvance;
}

type Suma = { bac: number; pv: number; ev: number; ac: number; evC: number; conCosto: number };
const cero = (): Suma => ({ bac: 0, pv: 0, ev: 0, ac: 0, evC: 0, conCosto: 0 });
function sumar(a: Suma, b: Suma) {
  a.bac += b.bac;
  a.pv += b.pv;
  a.ev += b.ev;
  a.ac += b.ac;
  a.evC += b.evC;
  a.conCosto += b.conCosto;
}
function cerrar(s: Suma) {
  const pctPlaneado = s.bac > EPS ? redondear((s.pv / s.bac) * 100, 2) : 0;
  const pctReal = s.bac > EPS ? redondear((s.ev / s.bac) * 100, 2) : 0;
  return {
    bac: redondear(s.bac, 2),
    pv: redondear(s.pv, 2),
    ev: redondear(s.ev, 2),
    ac: s.conCosto ? redondear(s.ac, 2) : null,
    pctPlaneado,
    pctReal,
    spi: s.pv > EPS ? redondear(s.ev / s.pv, 3) : null,
    cpi: s.conCosto && s.ac > EPS ? redondear(s.evC / s.ac, 3) : null,
    estado: estadoAvance(pctPlaneado, pctReal),
  };
}

/** What each baseline task planned, earned and cost by the cut, split among the partidas it does (by its cost of each). */
function porTarea(m: Medidor, corte: CorteAvance, cada: (t: TareaBase, s: Suma, partida: string | null) => void) {
  const h = m.hora(corte.fecha);
  for (const t of m.partidas) {
    const a = corte.partidas[t.id];
    const pct = (a?.pct ?? 0) / 100;
    const frac = fraccionPlaneada(t, h);
    const conCosto = a?.costo !== undefined;
    const asign = asignacionesDe(t);
    if (!asign.length) {
      cada(t, { bac: t.costo, pv: t.costo * frac, ev: t.costo * pct, ac: a?.costo ?? 0, evC: conCosto ? t.costo * pct : 0, conCosto: conCosto ? 1 : 0 }, null);
      continue;
    }
    const total = asign.reduce((x, y) => x + y.costo, 0);
    for (const x of asign) {
      const parte = total > EPS ? x.costo / total : 1 / asign.length;
      cada(t, { bac: x.costo, pv: x.costo * frac, ev: x.costo * pct, ac: (a?.costo ?? 0) * parte, evC: conCosto ? x.costo * pct : 0, conCosto: conCosto ? 1 : 0 }, x.partida);
    }
  }
}

/**
 * The earned value by the budget's outline (its chapters and partidas): each
 * task's values go to the partidas it does. Partidas no longer in the budget
 * show apart.
 */
export function controlPorPresupuesto(m: Medidor, corte: CorteAvance, estructura: FilaEstructura[]): FilaAgrupada[] {
  const porPartida = new Map<string, Suma>();
  porTarea(m, corte, (_t, s, partida) => {
    if (!partida) return;
    const x = porPartida.get(partida) ?? cero();
    sumar(x, s);
    porPartida.set(partida, x);
  });
  const sumas = new Map<string, Suma>();
  const enEstructura = new Set<string>();
  for (const f of estructura) {
    if (f.tipo !== "partida") continue;
    enEstructura.add(f.id);
    const s = porPartida.get(f.id);
    if (!s) continue;
    for (const id of [f.id, ...f.ancestros]) {
      const x = sumas.get(id) ?? cero();
      sumar(x, s);
      sumas.set(id, x);
    }
  }
  const filas: FilaAgrupada[] = estructura.map((f) => ({ id: f.id, tipo: f.tipo, numero: f.numero, descripcion: f.descripcion, nivel: f.nivel, responsable: "", ...cerrar(sumas.get(f.id) ?? cero()) }));
  const fuera = cero();
  for (const [id, s] of porPartida) if (!enEstructura.has(id)) sumar(fuera, s);
  if (fuera.bac > EPS || fuera.ev > EPS) filas.push({ id: "__fuera", tipo: "sp", numero: "", descripcion: "Partidas que ya no están en el presupuesto", nivel: 0, responsable: "", ...cerrar(fuera) });
  return filas;
}

/**
 * The earned value by control account: the EDT node with a person in charge
 * nearest to each task (tasks with none go to "Sin responsable").
 */
export function controlPorCuenta(m: Medidor, corte: CorteAvance): FilaAgrupada[] {
  const cuentas = new Map<string, Suma>();
  porTarea(m, corte, (t, s) => {
    let cuenta = "";
    for (let i = t.ancestros.length - 1; i >= 0; i--) {
      if (m.porId.get(t.ancestros[i])?.responsable) {
        cuenta = t.ancestros[i];
        break;
      }
    }
    const x = cuentas.get(cuenta) ?? cero();
    sumar(x, s);
    cuentas.set(cuenta, x);
  });
  const ultimo = "\uffff";
  return [...cuentas]
    .map(([id, s]): FilaAgrupada => {
      const n = id ? m.porId.get(id)! : null;
      return { id: id || "__sin", tipo: "cuenta", numero: n?.numero ?? "", descripcion: n?.descripcion ?? "Sin responsable", nivel: 0, responsable: n?.responsable ?? "", ...cerrar(s) };
    })
    .sort((a, b) => (a.responsable || ultimo).localeCompare(b.responsable || ultimo, "es") || a.numero.localeCompare(b.numero, "es", { numeric: true }));
}
