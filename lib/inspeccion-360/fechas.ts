// Dates of Inspección 360°. Colombia has no daylight saving: Bogotá is always UTC−05:00. The
// camera writes local time without a zone, so it is read as Bogotá time. Screens: DD-MM-AAAA.

const DESFASE_MS = -5 * 60 * 60 * 1000;

export interface Local {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

/** Calendar parts in Bogotá of an instant. */
export function enBogota(iso: string | Date): Local {
  const t = (typeof iso === "string" ? new Date(iso) : iso).getTime() + DESFASE_MS;
  const d = new Date(t);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), minuto: d.getUTCMinutes(), segundo: d.getUTCSeconds() };
}

const dos = (n: number) => String(n).padStart(2, "0");

/** "26-11-2026". */
export function fmtFecha(iso: string): string {
  const l = enBogota(iso);
  return `${dos(l.dia)}-${dos(l.mes)}-${l.anio}`;
}

/** "26-11-2026 09:30". */
export function fmtFechaHora(iso: string): string {
  const l = enBogota(iso);
  return `${fmtFecha(iso)} ${dos(l.hora)}:${dos(l.minuto)}`;
}

/** EXIF "2026:11:26 09:30:15" (camera local time) → ISO in Bogotá, or null if it is not a date. */
export function isoDesdeExif(texto: string | null | undefined): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(texto ?? "");
  if (!m || m[1] === "0000") return null;
  return validarIso(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-05:00`);
}

/** The value of an <input type="datetime-local"> ("2026-11-26T09:30") read as Bogotá time. */
export function isoDesdeLocal(texto: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (!m) return null;
  return validarIso(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}-05:00`);
}

/** For an <input type="datetime-local">: "2026-11-26T09:30" in Bogotá. */
export function paraInputLocal(iso: string): string {
  const l = enBogota(iso);
  return `${l.anio}-${dos(l.mes)}-${dos(l.dia)}T${dos(l.hora)}:${dos(l.minuto)}`;
}

function validarIso(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // "2026-02-31" parses in some engines by rolling over: check it round-trips.
  const l = enBogota(new Date(t));
  return iso.startsWith(`${l.anio}-${dos(l.mes)}-${dos(l.dia)}T${dos(l.hora)}:${dos(l.minuto)}`) ? iso : null;
}
