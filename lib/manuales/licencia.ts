// Licenses of the people authorized to read the manuals: from a start date,
// for 1 to 12 months (or up to a chosen date, or without expiry), and their
// status. Dates are ISO "YYYY-MM-DD" (shown as DD-MM-AAAA); "today" is the
// company's day (Colombia unless MANUALES_ZONA says otherwise).

export type EstadoLicencia = "activa" | "por-vencer" | "vencida" | "suspendida" | "sin-vencimiento";

export const MAX_MESES = 12;
/** A license "is about to expire" this many days before its last day. */
export const DIAS_AVISO = 15;

export const ESTADO_LABELS: Record<EstadoLicencia, string> = {
  activa: "Activa",
  "por-vencer": "Por vencer",
  vencida: "Vencida",
  suspendida: "Suspendida",
  "sin-vencimiento": "Sin vencimiento",
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esFecha(iso: unknown): iso is string {
  if (typeof iso !== "string") return false;
  const m = ISO.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Today in the company's time zone, as "YYYY-MM-DD". */
export function hoyIso(ahora: Date = new Date(), zona = "America/Bogota"): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** "2026-01-31" + 1 month -> "2026-02-28" (the day is clamped to the month's last). */
export function sumarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + meses;
  const anio = y + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(anio, mes, Math.min(d, ultimo)));
  return out.toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/**
 * A license's status on `hoy`. The expiry date is the last day with access
 * (`diasRestantes` 0 on that day).
 */
export function estadoLicencia(a: { vence: string | null; suspendido: boolean }, hoy: string): { estado: EstadoLicencia; diasRestantes: number | null } {
  if (a.suspendido) return { estado: "suspendida", diasRestantes: a.vence ? diasEntre(hoy, a.vence) : null };
  if (!a.vence) return { estado: "sin-vencimiento", diasRestantes: null };
  const dias = diasEntre(hoy, a.vence);
  if (dias < 0) return { estado: "vencida", diasRestantes: dias };
  return { estado: dias <= DIAS_AVISO ? "por-vencer" : "activa", diasRestantes: dias };
}

export function vigente(estado: EstadoLicencia): boolean {
  return estado === "activa" || estado === "por-vencer" || estado === "sin-vencimiento";
}

/** "20-05-2026" from "2026-05-20". */
export function fechaVisible(iso: string | null): string {
  const m = iso ? ISO.exec(iso) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * The period a purchase of `meses` gives: a license still in force is
 * extended from its last day; an expired one (or a new person, `vence`
 * undefined) starts today. null when the license doesn't expire.
 */
export function periodoComprado(vence: string | null | undefined, meses: number, hoy: string): { inicio: string; vence: string } | null {
  if (vence === null) return null;
  const inicio = vence !== undefined && vence >= hoy ? vence : hoy;
  return { inicio, vence: sumarMeses(inicio, meses) };
}
