// Progress against the approved schedule (earned value). The baseline freezes
// the schedule's dates and planned costs; each progress report (corte) gives
// every partida's cumulative % and, when recorded, its actual cost. From them
// come the planned value (PV), the earned value (EV) and the actual cost (AC),
// and the indicators that tell whether the work is ahead or behind, in time
// (SPI, earned schedule) and in cost (CPI).
import { redondear } from "./calc";
import { Calendario, sumarDias } from "./calendario";
import { periodos, Periodo, Programado, TipoPeriodo } from "./programacion";
import type { CorteAvance, EjecucionItem, LineaBaseDatos, Programacion, TareaBase } from "./types";

const EPS = 1e-9;

/** The schedule on screen, frozen as a baseline. */
export function lineaBaseDe(res: Programado, prog: Programacion): LineaBaseDatos {
  const tareas: TareaBase[] = res.filas
    .filter((f) => !f.vacia)
    .map((f) => ({
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
    }));
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

/**
 * Each element's state at a date: built for all its partidas, or pending, and
 * then late (its partida should have finished by then in the baseline), in
 * progress (its partida was planned to be under way) or not due yet. An
 * element of several partidas takes the worst of them.
 */
export function estadoElementos(
  elementos: { itemId: string; ifcGuid: string; modelId: string; ejecutado?: string | null }[],
  fecha: string,
  base: LineaBaseDatos | null
): Map<string, { estado: EstadoElemento; modelId: string }> {
  const plan = new Map((base?.tareas ?? []).filter((t) => t.tipo === "partida").map((t) => [t.id, t]));
  const out = new Map<string, { estado: EstadoElemento; modelId: string }>();
  for (const e of elementos) {
    let estado: EstadoElemento = "ejecutado";
    if (!e.ejecutado || e.ejecutado > fecha) {
      const t = plan.get(e.itemId);
      estado = !t ? "pendiente" : t.fin <= fecha ? "atrasado" : t.inicio <= fecha ? "en-curso" : "pendiente";
    }
    const antes = out.get(e.ifcGuid);
    if (!antes || PESO[estado] > PESO[antes.estado]) out.set(e.ifcGuid, { estado, modelId: e.modelId });
  }
  return out;
}
