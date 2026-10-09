// "Memoria de cantidades": where each linked element is (block, set, zone,
// zone name, space), read from the model properties with those names.
import type { Field, ModelDataset, ObjectRecord } from "../graficos/modelData";
import { plegar } from "./format";
import type { Memoria } from "./types";

export const MEMORIA_CAMPOS: { key: keyof Memoria; label: string; nombres: string[] }[] = [
  { key: "bloque", label: "Bloque", nombres: ["bloque"] },
  { key: "conjunto", label: "Conjunto", nombres: ["conjunto"] },
  { key: "zona", label: "Zona", nombres: ["zona"] },
  { key: "nombreZona", label: "Nombre de zona", nombres: ["nombre de zona", "nombre zona", "nombrezona"] },
  { key: "espacio", label: "Espacio", nombres: ["espacio"] },
];

const MAX = 100;

function limpio(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, MAX) : "";
}

/** The element's location from the properties of its model, or null when it has none of them. */
export function memoriaDe(dataset: Pick<ModelDataset, "fields">, record: ObjectRecord | undefined): Memoria | null {
  if (!record) return null;
  const porNombre = new Map<string, Field[]>();
  for (const f of dataset.fields.values()) {
    const k = plegar(f.label).replace(/\s+/g, " ").trim();
    porNombre.set(k, [...(porNombre.get(k) ?? []), f]);
  }
  const out: Memoria = { bloque: "", conjunto: "", zona: "", nombreZona: "", espacio: "" };
  let any = false;
  for (const c of MEMORIA_CAMPOS) {
    for (const nombre of c.nombres) {
      const value = (porNombre.get(nombre) ?? []).map((f) => limpio(record.values[f.key])).find(Boolean);
      if (value) {
        out[c.key] = value;
        any = true;
        break;
      }
    }
  }
  return any ? out : null;
}

/** A memoria as received from a client: known fields only, short text, null when empty. */
export function memoriaLimpia(value: unknown): Memoria | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const out: Memoria = { bloque: limpio(o.bloque), conjunto: limpio(o.conjunto), zona: limpio(o.zona), nombreZona: limpio(o.nombreZona), espacio: limpio(o.espacio) };
  return Object.values(out).some(Boolean) ? out : null;
}

/** Orders the elements by block, set, zone and space, numbers in their natural order ("2" before "10"). */
export function porUbicacion<T extends { memoria: Memoria | null }>(list: T[]): T[] {
  const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  const clave = (e: T) => MEMORIA_CAMPOS.map((c) => e.memoria?.[c.key] ?? "");
  return [...list].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i++) {
      const d = collator.compare(ka[i], kb[i]);
      if (d) return d;
    }
    return 0;
  });
}
