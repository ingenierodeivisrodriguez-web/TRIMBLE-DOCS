// "Memoria de cantidades": for each linked element, the data the user chose to
// see (block, zone, level, id...), read from the properties of the model when
// the element is linked, or live from the Propiedades app.
import type { Field, ModelDataset, ObjectRecord } from "../graficos/modelData";
import { plegar } from "./format";
import { ColumnaMemoria, DEFAULT_COLUMNAS_MEMORIA, Memoria } from "./types";

/** Other names the default columns are known by in models. */
const ALIAS: Record<string, string[]> = { nombreZona: ["nombre de zona", "nombre zona", "nombrezona"] };

const MAX = 100;

function limpio(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, MAX) : "";
}

const nombre = (text: string) => plegar(text).replace(/\s+/g, " ").trim();

/** The columns in use: the saved ones, or the defaults. */
export function columnasMemoria(guardadas: ColumnaMemoria[] | null | undefined): ColumnaMemoria[] {
  return guardadas && guardadas.length > 0 ? guardadas : DEFAULT_COLUMNAS_MEMORIA;
}

/**
 * The element's data for the columns that come from the model (the others are
 * not read here), or null when it has none of them.
 */
export function memoriaDe(
  dataset: Pick<ModelDataset, "fields">,
  record: ObjectRecord | undefined,
  columnas: ColumnaMemoria[] = DEFAULT_COLUMNAS_MEMORIA
): Memoria | null {
  if (!record) return null;
  const porNombre = new Map<string, Field[]>();
  for (const f of dataset.fields.values()) {
    const k = nombre(f.label);
    porNombre.set(k, [...(porNombre.get(k) ?? []), f]);
  }
  const out: Memoria = {};
  let any = false;
  for (const c of columnas) {
    if (c.fuente !== "modelo") continue;
    let value = "";
    const exacto = dataset.fields.get(c.clave); // "Set · Property"
    if (exacto) value = limpio(record.values[exacto.key]);
    if (!value) {
      for (const n of [nombre(c.clave), ...(ALIAS[c.id] ?? [])]) {
        value = (porNombre.get(n) ?? []).map((f) => limpio(record.values[f.key])).find(Boolean) ?? "";
        if (value) break;
      }
    }
    out[c.id] = value;
    if (value) any = true;
  }
  return any ? out : null;
}

const ID_COLUMNA = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_CLAVES = 12;

/** A memoria as received from a client: short text values under valid column ids, null when empty. */
export function memoriaLimpia(value: unknown): Memoria | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Memoria = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_CLAVES)) {
    if (ID_COLUMNA.test(k)) out[k] = limpio(v);
  }
  return Object.values(out).some(Boolean) ? out : null;
}

/** Orders the elements by the columns' data, numbers in their natural order ("2" before "10"). */
export function porUbicacion<T extends { memoria: Memoria | null }>(list: T[], columnas: ColumnaMemoria[] = DEFAULT_COLUMNAS_MEMORIA): T[] {
  const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  const ids = columnas.filter((c) => c.fuente !== "ifcguid").map((c) => c.id);
  return [...list].sort((a, b) => {
    for (const id of ids) {
      const d = collator.compare(a.memoria?.[id] ?? "", b.memoria?.[id] ?? "");
      if (d) return d;
    }
    return 0;
  });
}

/**
 * What gets stored for an element: the model columns only (Propiedades values
 * are read live), the new reading over the previous one where it found data.
 */
export function memoriaParaGuardar(columnas: ColumnaMemoria[], previa: Memoria | null | undefined, nueva: Memoria | null | undefined): Memoria | null {
  const out: Memoria = {};
  for (const c of columnas) {
    if (c.fuente !== "modelo") continue;
    out[c.id] = nueva?.[c.id] || previa?.[c.id] || "";
  }
  return Object.values(out).some(Boolean) ? out : null;
}
