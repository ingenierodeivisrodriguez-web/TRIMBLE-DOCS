// What a call to the model costs and how much of the monthly quota is left.
// Prices are the API's list prices in USD per million tokens; pesos use the
// exchange rate (TRM) the platform's administrator sets.
import type { CupoGlobalIA, CupoGuardado, CupoIA, EstadoCupo } from "./tipos";

interface Precio {
  entrada: number;
  salida: number;
  cacheLectura: number;
}

/** USD per million tokens (cache writes cost 1.25 × the input price). */
const PRECIOS: Record<string, Precio> = {
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLectura: 0.2 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLectura: 0.2 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLectura: 0.01 },
  "claude-opus-5": { entrada: 5, salida: 25, cacheLectura: 0.5 },
  "claude-opus-4-8": { entrada: 5, salida: 25, cacheLectura: 0.5 },
  // Google AI Studio, paid tier (thinking is billed as output). The free tier costs nothing, but
  // the quota counts these reference prices so it still limits use. Google announced that the
  // 3.8 and 3.6 Flash prices double on 01-01-2027.
  "gemini-3.8-flash": { entrada: 0.75, salida: 3.75, cacheLectura: 0.075 },
  "gemini-3.6-flash": { entrada: 0.75, salida: 3.75, cacheLectura: 0.075 },
  "gemini-3.5-flash-lite": { entrada: 0.3, salida: 2.5, cacheLectura: 0.03 },
  "gemini-3.1-flash-lite": { entrada: 0.25, salida: 1.5, cacheLectura: 0.025 },
  "gemini-4-argon": { entrada: 2, salida: 10, cacheLectura: 0.1 },
};
/** A model not in the table is counted at the highest price, so the quota never falls short. */
const PRECIO_DESCONOCIDO: Precio = { entrada: 10, salida: 50, cacheLectura: 1 };

export function precioDe(modelo: string): Precio {
  return PRECIOS[modelo] ?? PRECIO_DESCONOCIDO;
}

export interface TokensIA {
  modelo: string;
  entrada: number;
  salida: number;
  cacheEscritura: number;
  cacheLectura: number;
}

export function costoUsd(partes: TokensIA[]): number {
  let usd = 0;
  for (const t of partes) {
    const p = precioDe(t.modelo);
    usd += (t.entrada * p.entrada + t.salida * p.salida + t.cacheEscritura * p.entrada * 1.25 + t.cacheLectura * p.cacheLectura) / 1_000_000;
  }
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function aCop(usd: number, trm: number): number {
  return Math.round(usd * trm * 100) / 100;
}

/** A rough cost of a call before making it: ~3.5 characters a token in, a ceiling for what comes out. */
export function estimarCostoCop(modelo: string, caracteresEntrada: number, tokensSalida: number, trm: number): number {
  return aCop(costoUsd([{ modelo, entrada: Math.ceil(caracteresEntrada / 3.5), salida: tokensSalida, cacheEscritura: 0, cacheLectura: 0 }]), trm);
}

export const TRM_POR_DEFECTO = 4000;

/** Defaults when nothing is stored: off, no quota. */
export function globalPorDefecto(): CupoGlobalIA {
  const trm = Number(process.env.PRESUPUESTO_IA_TRM);
  return { habilitada: false, cupoProyectoCop: 0, cupoUsuarioCop: 0, trm: Number.isFinite(trm) && trm > 0 ? trm : TRM_POR_DEFECTO };
}

/** The first day of the month in Colombia (UTC-5, no daylight saving): the quota restarts then. */
export function inicioDeMes(ahora: Date = new Date()): { fecha: string; desde: string } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" }).formatToParts(ahora);
  const y = partes.find((p) => p.type === "year")!.value;
  const m = partes.find((p) => p.type === "month")!.value;
  return { fecha: `${y}-${m}-01`, desde: `${y}-${m}-01T00:00:00-05:00` };
}

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** "$ 12.500" */
export function fmtCop(n: number): string {
  return pesos.format(Math.round(n)).replace(/ /g, " ");
}

/** Where the quota stands: below 80 %, in the warning zone, used up, or the assistant is off. */
export function estadoCupo(
  propio: CupoGuardado | null,
  global: CupoGlobalIA,
  gasto: { proyecto: number; usuario: number },
  mes: string
): EstadoCupo {
  const cupo: CupoIA = propio ?? global;
  const base = {
    habilitada: cupo.habilitada,
    cupoProyectoCop: cupo.cupoProyectoCop,
    cupoUsuarioCop: cupo.cupoUsuarioCop,
    propio: !!propio,
    trm: global.trm,
    gastoProyectoCop: Math.round(gasto.proyecto * 100) / 100,
    gastoUsuarioCop: Math.round(gasto.usuario * 100) / 100,
    mes,
  };
  if (!cupo.habilitada) {
    return { ...base, nivel: "deshabilitada", mensaje: "El asistente IA no está habilitado en este proyecto. Lo habilita el administrador de la plataforma." };
  }
  const razones = [
    { cupo: cupo.cupoProyectoCop, gasto: gasto.proyecto, quien: "del proyecto" },
    { cupo: cupo.cupoUsuarioCop, gasto: gasto.usuario, quien: "tuyo" },
  ];
  for (const r of razones) {
    if (r.cupo <= 0 || r.gasto >= r.cupo) {
      return { ...base, nivel: "agotado", mensaje: `Se agotó el cupo ${r.quien} de este mes (${fmtCop(r.cupo)}). Se renueva el primer día del mes siguiente.` };
    }
  }
  const usado = Math.max(gasto.proyecto / cupo.cupoProyectoCop, gasto.usuario / cupo.cupoUsuarioCop);
  if (usado >= 0.8) {
    const quien = gasto.proyecto / cupo.cupoProyectoCop >= gasto.usuario / cupo.cupoUsuarioCop ? "del proyecto" : "tuyo";
    return { ...base, nivel: "aviso", mensaje: `Ya se usó el ${Math.floor(usado * 100)} % del cupo ${quien} de este mes.` };
  }
  return { ...base, nivel: "ok", mensaje: "" };
}

/** What is left for the next call (the smaller of the project's and the person's). */
export function disponibleCop(e: EstadoCupo): number {
  if (e.nivel === "deshabilitada" || e.nivel === "agotado") return 0;
  return Math.max(0, Math.min(e.cupoProyectoCop - e.gastoProyectoCop, e.cupoUsuarioCop - e.gastoUsuarioCop));
}
