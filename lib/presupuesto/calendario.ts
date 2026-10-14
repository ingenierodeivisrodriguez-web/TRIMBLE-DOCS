// The schedule's working calendar: how many hours are worked each day. The
// schedule is computed in working hours counted from the project's start, and
// this turns those hours into dates and back.
import type { CalendarioLaboral, DiaEspecial } from "./types";

const DIA_MS = 86_400_000;
/** The furthest the calendar looks ahead from the start (40 years). */
const MAX_DIAS = 366 * 40;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esFechaIso(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const m = ISO_RE.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function utc(iso: string): number {
  const m = ISO_RE.exec(iso)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function sumarDias(fecha: string, dias: number): string {
  return iso(utc(fecha) + dias * DIA_MS);
}

/** Days from `a` to `b` (negative if `b` is before). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DIA_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function diaSemana(fecha: string): number {
  return (new Date(utc(fecha)).getUTCDay() + 6) % 7;
}

/** "2026-10-13" -> "13-10-2026" (dates are always shown DD-MM-AAAA). */
export function fechaCorta(fecha: string): string {
  const m = ISO_RE.exec(fecha);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : fecha;
}

export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function calendarioPorDefecto(): CalendarioLaboral {
  return { horasSemana: [8, 8, 8, 8, 8, 0, 0], jornada: 8, especiales: [] };
}

/**
 * Working hours counted from the start date: hour 0 is the first working
 * hour of the start date (or of the next working day).
 */
export class Calendario {
  private readonly especiales: Map<string, number>;
  /** cum[k]: hours worked before day k (day 0 is the start date). */
  private readonly cum: number[] = [0];
  private readonly horas: number[] = [];

  constructor(
    readonly cfg: CalendarioLaboral,
    readonly inicio: string
  ) {
    this.especiales = new Map(cfg.especiales.map((d) => [d.fecha, d.horas]));
    if (!cfg.horasSemana.some((h) => h > 0) && ![...this.especiales.values()].some((h) => h > 0)) {
      throw new Error("El calendario no tiene ningún día con horas de trabajo.");
    }
  }

  horasDel(fecha: string): number {
    return this.especiales.get(fecha) ?? this.cfg.horasSemana[diaSemana(fecha)] ?? 0;
  }

  /** Makes sure day `k` is laid out. */
  private hasta(k: number) {
    const tope = Math.min(k, MAX_DIAS);
    for (let i = this.horas.length; i <= tope; i++) {
      const h = this.horasDel(sumarDias(this.inicio, i));
      this.horas.push(h);
      this.cum.push(this.cum[i] + h);
    }
  }

  /** Day index of a date (0 = the start date). */
  indice(fecha: string): number {
    return diasEntre(this.inicio, fecha);
  }

  fecha(indice: number): string {
    return sumarDias(this.inicio, indice);
  }

  /** Hours worked before this date. Dates before the start count as the start. */
  horaDe(fecha: string): number {
    const k = this.indice(fecha);
    if (k <= 0) return 0;
    this.hasta(k);
    return this.cum[Math.min(k, MAX_DIAS)];
  }

  /** First day index whose cumulative end passes `h` (strictly when `estricto`). */
  private dia(h: number, estricto: boolean): number {
    const pasa = (k: number) => (estricto ? this.cum[k + 1] > h : this.cum[k + 1] >= h);
    if (this.horas.length === 0) this.hasta(365);
    while (!pasa(this.horas.length - 1) && this.horas.length <= MAX_DIAS) this.hasta(this.horas.length + 365);
    let lo = 0;
    let hi = this.horas.length - 1;
    if (!pasa(hi)) return hi;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pasa(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** The day the work right after `h` hours is done (where a task starting at `h` starts). */
  diaInicio(h: number): number {
    return this.dia(Math.max(h, 0), true);
  }

  /** The day the `h`-th hour is worked (where a task ending at `h` ends). */
  diaFin(h: number): number {
    return h <= 0 ? this.diaInicio(0) : this.dia(h, false);
  }

  fechaInicio(h: number): string {
    return this.fecha(this.diaInicio(h));
  }

  fechaFin(h: number): string {
    return this.fecha(this.diaFin(h));
  }

  /** Position in days from the start date, with the fraction of the day worked (for drawing bars). */
  posicion(h: number, extremo: "inicio" | "fin"): number {
    const k = extremo === "inicio" ? this.diaInicio(h) : this.diaFin(h);
    const horas = this.horas[k] || 1;
    return k + Math.min(Math.max((h - this.cum[k]) / horas, 0), 1);
  }

  /** Working hours of the day `k` (0 = start date). */
  horasDia(k: number): number {
    if (k < 0) return this.horasDel(this.fecha(k));
    this.hasta(k);
    return this.horas[Math.min(k, MAX_DIAS)] ?? 0;
  }
}

// ---------------------------------------------------------------- holidays

/** Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher). */
export function pascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** The Monday on or after the date (Colombia's "Ley Emiliani"). */
function lunesSiguiente(fecha: string): string {
  return sumarDias(fecha, (7 - diaSemana(fecha)) % 7);
}

/** Colombia's public holidays of a year (Ley 51 de 1983). */
export function festivosColombia(anio: number): DiaEspecial[] {
  const f = (mes: number, dia: number) => `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const p = pascua(anio);
  const lista: [string, string][] = [
    [f(1, 1), "Año Nuevo"],
    [lunesSiguiente(f(1, 6)), "Reyes Magos"],
    [lunesSiguiente(f(3, 19)), "San José"],
    [sumarDias(p, -3), "Jueves Santo"],
    [sumarDias(p, -2), "Viernes Santo"],
    [f(5, 1), "Día del Trabajo"],
    [sumarDias(p, 43), "Ascensión del Señor"],
    [sumarDias(p, 64), "Corpus Christi"],
    [sumarDias(p, 71), "Sagrado Corazón"],
    [lunesSiguiente(f(6, 29)), "San Pedro y San Pablo"],
    [f(7, 20), "Día de la Independencia"],
    [f(8, 7), "Batalla de Boyacá"],
    [lunesSiguiente(f(8, 15)), "La Asunción de la Virgen"],
    [lunesSiguiente(f(10, 12)), "Día de la Raza"],
    [lunesSiguiente(f(11, 1)), "Todos los Santos"],
    [lunesSiguiente(f(11, 11)), "Independencia de Cartagena"],
    [f(12, 8), "Inmaculada Concepción"],
    [f(12, 25), "Navidad"],
  ];
  // Two of them can fall on the same Monday (30-06-2025: Sagrado Corazón and San Pedro y San Pablo).
  const porFecha = new Map<string, string>();
  for (const [fecha, nombre] of lista) porFecha.set(fecha, porFecha.has(fecha) ? `${porFecha.get(fecha)} y ${nombre}` : nombre);
  return [...porFecha].map(([fecha, nombre]) => ({ fecha, horas: 0, nombre })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Adds days to the list (a date already in it keeps what the user set). */
export function agregarEspeciales(actuales: DiaEspecial[], nuevos: DiaEspecial[]): { especiales: DiaEspecial[]; agregados: number } {
  const fechas = new Set(actuales.map((d) => d.fecha));
  const agregar = nuevos.filter((d) => !fechas.has(d.fecha));
  return { especiales: [...actuales, ...agregar].sort((a, b) => a.fecha.localeCompare(b.fecha)), agregados: agregar.length };
}
