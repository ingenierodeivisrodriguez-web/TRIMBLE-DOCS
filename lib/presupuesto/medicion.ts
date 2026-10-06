// Quantities from the model: which numeric properties of the elements can
// measure a partida, which one fits its unit, and each element's value.
import type { ModelDataset, ObjectRecord } from "../graficos/modelData";
import { plegar } from "./format";
import { CONTEO } from "./types";

export interface CampoMedible {
  key: string;
  label: string;
  unit: string;
  /** Elements that have it. */
  count: number;
}

/** The numeric properties of these elements, the most common first. */
export function camposMedibles(datasets: ModelDataset[]): CampoMedible[] {
  const out = new Map<string, CampoMedible>();
  for (const d of datasets) {
    for (const [key, f] of d.fields) {
      if (f.kind !== "number" || key.startsWith("@")) continue;
      const c = out.get(key) ?? { key, label: `${f.group} · ${f.label}`, unit: f.unit ?? "", count: 0 };
      c.count += d.coverage.get(key) ?? 0;
      if (!c.unit && f.unit) c.unit = f.unit;
      out.set(key, c);
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

type Medida = "volumen" | "area" | "longitud" | "masa" | "conteo";

/** What a unit measures: "M3" -> volume, "M2" -> area, "ML" -> length, "KG" -> mass, "UND" -> count. */
export function medidaDeUnidad(unidad: string): Medida | null {
  const u = plegar(unidad).replace(/[\s.]/g, "");
  if (/^(m3|m³|mc|m\^3)$/.test(u)) return "volumen";
  if (/^(m2|m²|m\^2)$/.test(u)) return "area";
  if (/^(m|ml|mts?|metros?|metrolineal|lm)$/.test(u)) return "longitud";
  if (/^(kg|kgs|kilos?|t|ton|tn)$/.test(u)) return "masa";
  if (/^(und|unid|unidad|unidades|u|un|pza|pzas?|pieza|glb|gl|global|jgo|juego|pto|punto|est|cu)$/.test(u)) return "conteo";
  return null;
}

const PREFERENCIAS: Record<Exclude<Medida, "conteo">, { unit: string; names: RegExp[] }> = {
  volumen: { unit: "m³", names: [/net\s*volume|volumen\s*neto/i, /volume|volumen/i] },
  area: { unit: "m²", names: [/net\s*(side\s*)?area|area\s*neta/i, /area|área/i] },
  longitud: { unit: "m", names: [/^.*·\s*(length|longitud|largo)$/i, /length|longitud|largo/i] },
  masa: { unit: "kg", names: [/net\s*weight|peso\s*neto/i, /weight|peso|mass|masa/i] },
};

/** The property that best measures a partida of this unit (CONTEO for units counted by piece), or null. */
export function sugerirCampo(unidad: string, campos: CampoMedible[]): string | null {
  const medida = medidaDeUnidad(unidad);
  if (!medida) return null;
  if (medida === "conteo") return CONTEO;
  const pref = PREFERENCIAS[medida];
  const conUnidad = campos.filter((c) => c.unit === pref.unit);
  for (const re of pref.names) {
    const hit = conUnidad.find((c) => re.test(c.label)) ?? campos.find((c) => re.test(c.label));
    if (hit) return hit.key;
  }
  return conUnidad[0]?.key ?? null;
}

/** An element's quantity for the measure (1 when counting; null when it lacks the property). */
export function valorDe(record: ObjectRecord | undefined, campo: string | null): number | null {
  if (!campo || !record) return null;
  if (campo === CONTEO) return 1;
  const v = record.values[campo];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function etiquetaCampo(campo: string | null, campos: CampoMedible[], guardada?: string): string {
  if (!campo) return "Solo asociar (metrado manual)";
  if (campo === CONTEO) return "Conteo de elementos";
  const c = campos.find((x) => x.key === campo);
  return c ? `${c.label}${c.unit ? ` (${c.unit})` : ""}` : guardada || campo;
}
