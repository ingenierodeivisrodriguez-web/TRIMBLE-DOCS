// Importing parameters (from Excel, with the DYCO list's columns, or from the
// DYCO seed) into the catalog. Nothing is overwritten silently: every row
// that would change an existing parameter is listed with its differences,
// and only the columns present in the file are compared and applied (the
// original DYCO sheet has no aliases, so importing it never clears them).
import { plegar } from "../presupuesto/format";
import { leerListaAlias, textoListaAlias } from "./alias";
import { errorPatron } from "./reglas";
import { codigoDyco, parametrosDyco } from "./semilla";
import { Ndi, ORIGENES, OrigenDato, Parametro, ParametroData, REGLA_VACIA, TIPOS_DATO, TipoDato, MAX_CORTO, MAX_TEXTO } from "./types";

export type Celda = string | number | boolean | Date | null;

export type Campo = "codigo" | "numero" | "nombre" | "descripcion" | "tdi" | "ndi" | "origen" | "tipoDato" | "unidad" | "valoresPermitidos" | "min" | "max" | "patron" | "alias" | "idsUri" | "activo";

/** The DYCO list's own columns, in its order. */
export const CAMPOS_DYCO: Campo[] = ["numero", "tdi", "ndi", "origen", "nombre", "descripcion"];

export const NOMBRE_CAMPO: Record<Campo, string> = {
  codigo: "Código",
  numero: "N°",
  nombre: "Parámetro",
  descripcion: "Descripción",
  tdi: "TDI",
  ndi: "NDI",
  origen: "Dato",
  tipoDato: "Tipo de dato",
  unidad: "Unidad",
  valoresPermitidos: "Valores permitidos",
  min: "Mínimo",
  max: "Máximo",
  patron: "Patrón",
  alias: "Equivalencias de lectura",
  idsUri: "URI IDS / bSDD",
  activo: "Activo",
};

/** Excel columns, DYCO's first, then the ones this app adds. */
export const COLUMNAS_EXCEL: Campo[] = [...CAMPOS_DYCO, "codigo", "tipoDato", "unidad", "valoresPermitidos", "min", "max", "patron", "alias", "idsUri", "activo"];

const ENCABEZADOS: Record<Campo, string[]> = {
  numero: ["n", "no", "numero", "num", "item"],
  tdi: ["tdi", "tipo de informacion"],
  ndi: ["ndi", "nivel de informacion", "nivel"],
  origen: ["dato", "origen", "origen del dato"],
  nombre: ["parametro", "nombre", "nombre del parametro", "nombre dyco"],
  descripcion: ["descripcion"],
  codigo: ["codigo", "codigo interno"],
  tipoDato: ["tipo de dato", "tipo"],
  unidad: ["unidad", "und"],
  valoresPermitidos: ["valores permitidos", "valores", "lista de valores"],
  min: ["minimo", "min"],
  max: ["maximo", "max"],
  patron: ["patron", "expresion regular"],
  alias: ["equivalencias de lectura", "equivalencias", "alias"],
  idsUri: ["uri ids bsdd", "uri", "ids", "bsdd"],
  activo: ["activo"],
};

const claveEncabezado = (h: Celda) => plegar(String(h ?? "")).replace(/[^a-z0-9]+/g, " ").trim();

/** One row read from a sheet or the seed: its values and the columns it brings. */
export interface Entrada {
  /** Excel row (1-based); null for the seed. */
  fila: number | null;
  datos: Partial<ParametroData>;
  /** Columns compared and applied to an existing parameter. */
  columnas: Campo[];
}

function celdaTexto(c: Celda): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

const ORIGEN_DE: [RegExp, OrigenDato][] = [
  [/^a ingresar|^ingres/, "a_ingresar"],
  [/^autom/, "automatica"],
  [/^$|sin definir|por definir/, "por_definir"],
];

function tipoDe(t: string): TipoDato | null {
  const k = plegar(t).trim();
  if (!k) return null;
  for (const [tipo, nombre] of Object.entries(TIPOS_DATO) as [TipoDato, string][]) if (plegar(nombre) === k || tipo === k) return tipo;
  if (/^(si\s*\/\s*no|booleano|bool|verdadero\/falso)$/.test(k)) return "booleano";
  if (/^(numero|numerico|entero|decimal)$/.test(k)) return "numero";
  if (/^lista/.test(k)) return "lista";
  return null;
}

/** A number cell; empty or a dash ("—", as rows without N° have) is null, anything else not numeric is NaN. */
function numeroCelda(c: Celda): number | null {
  if (typeof c === "number") return c;
  const t = celdaTexto(c);
  return !t || /^[-—–]+$/.test(t) ? null : Number(t.replace(",", "."));
}

/**
 * The parameters of a sheet whose first non-empty rows hold the headers (the
 * DYCO list has a title row above them). Rows without a name are ignored.
 */
export function leerHojaParametros(hoja: Celda[][]): { entradas: Entrada[]; errores: string[] } {
  const errores: string[] = [];
  const inicio = hoja.findIndex((fila) => fila.some((c) => ENCABEZADOS.nombre.includes(claveEncabezado(c))));
  if (inicio < 0) return { entradas: [], errores: ["No se encontró la columna \"Parámetro\" en la hoja."] };
  const indice = new Map<Campo, number>();
  hoja[inicio].forEach((c, i) => {
    const k = claveEncabezado(c);
    for (const [campo, nombres] of Object.entries(ENCABEZADOS) as [Campo, string[]][]) {
      if (!indice.has(campo) && nombres.includes(k)) indice.set(campo, i);
    }
  });
  const columnas = [...indice.keys()];
  const entradas: Entrada[] = [];

  for (let r = inicio + 1; r < hoja.length; r++) {
    const fila = hoja[r];
    const celda = (campo: Campo): Celda => {
      const i = indice.get(campo);
      return i === undefined ? null : (fila[i] ?? null);
    };
    const nombre = celdaTexto(celda("nombre"));
    if (!nombre) continue;
    const donde = `Fila ${r + 1} ("${nombre.slice(0, 40)}")`;
    const datos: Partial<ParametroData> = { nombre: nombre.slice(0, MAX_CORTO) };
    let ok = true;
    const error = (texto: string) => {
      errores.push(`${donde}: ${texto}`);
      ok = false;
    };

    if (indice.has("numero")) {
      const n = numeroCelda(celda("numero"));
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100000)) error("el N° debe ser un número entero.");
      else datos.numero = n;
    }
    if (indice.has("tdi")) {
      const m = /^(?:TDI\s*-?\s*)?([A-Z])$/i.exec(celdaTexto(celda("tdi")));
      if (!m) error("el TDI debe ser una letra (TDI-A, TDI-B…).");
      else datos.tdi = m[1].toUpperCase();
    }
    if (indice.has("ndi")) {
      // Any level from 1 to 9 is read; saving checks it is one of the catalog's.
      const m = /^(?:NDI\s*-?\s*)?([1-9])$/i.exec(celdaTexto(celda("ndi")));
      if (!m) error("el NDI debe ser un número del 1 al 9 (NDI-1, NDI-2…).");
      else datos.ndi = Number(m[1]) as Ndi;
    }
    if (indice.has("origen")) {
      const k = plegar(celdaTexto(celda("origen"))).replace(/[()]/g, "").trim();
      const origen = ORIGEN_DE.find(([re]) => re.test(k))?.[1];
      if (!origen) error(`el Dato debe ser "${ORIGENES.a_ingresar}", "${ORIGENES.automatica}" o vacío.`);
      else datos.origen = origen;
    }
    if (indice.has("descripcion")) datos.descripcion = celdaTexto(celda("descripcion")).slice(0, MAX_TEXTO);
    if (indice.has("codigo")) {
      const codigo = celdaTexto(celda("codigo"));
      if (codigo.length > 40) error("el código tiene más de 40 caracteres.");
      else if (codigo) datos.codigo = codigo;
    }
    if (indice.has("tipoDato")) {
      const t = celdaTexto(celda("tipoDato"));
      const tipo = tipoDe(t);
      if (t && !tipo) error(`tipo de dato "${t}" no reconocido (Texto, Número, Sí / No, Fecha o Lista de valores).`);
      else datos.tipoDato = tipo ?? "texto";
    }
    if (indice.has("unidad")) datos.unidad = celdaTexto(celda("unidad")).slice(0, 20);
    if (indice.has("valoresPermitidos")) {
      datos.valoresPermitidos = [...new Set(celdaTexto(celda("valoresPermitidos")).split(/[;\n|]+/).map((v) => v.trim()).filter(Boolean))].slice(0, 100);
    }
    const regla = { ...REGLA_VACIA };
    for (const campo of ["min", "max"] as const) {
      if (!indice.has(campo)) continue;
      const n = numeroCelda(celda(campo));
      if (n !== null && !Number.isFinite(n)) error(`el ${NOMBRE_CAMPO[campo].toLowerCase()} no es un número.`);
      else regla[campo] = n;
    }
    if (indice.has("patron")) {
      regla.patron = celdaTexto(celda("patron"));
      const e = errorPatron(regla.patron);
      if (e) error(e);
    }
    if (indice.has("min") || indice.has("max") || indice.has("patron")) {
      if (regla.min !== null && regla.max !== null && regla.min > regla.max) error("el mínimo es mayor que el máximo.");
      datos.regla = regla;
    }
    if (indice.has("alias")) {
      const { alias, errores: malos } = leerListaAlias(celdaTexto(celda("alias")));
      if (malos.length) error(`equivalencias no válidas: ${malos.join(", ")} (se escriben Grupo.Propiedad, *.Propiedad o @Atributo).`);
      else datos.alias = alias;
    }
    if (indice.has("idsUri")) datos.idsUri = celdaTexto(celda("idsUri")).slice(0, 500);
    if (indice.has("activo")) {
      const k = plegar(celdaTexto(celda("activo")));
      datos.activo = !(k === "no" || k === "false" || k === "0" || k === "inactivo");
    }
    if (ok) entradas.push({ fila: r + 1, datos, columnas });
  }
  return { entradas, errores };
}

/** The DYCO seed as import rows: its own columns are compared with what exists; new ones come complete. */
export function entradasDyco(): Entrada[] {
  return parametrosDyco().map((datos) => ({ fila: null, datos, columnas: CAMPOS_DYCO }));
}

// ---------------------------------------------------------------- the plan

export interface Diferencia {
  campo: Campo;
  antes: string;
  despues: string;
}

export interface FilaPlan {
  fila: number | null;
  tipo: "nuevo" | "cambia";
  /** The parameter that would change (null when new). */
  existente: Parametro | null;
  /** What would be saved. */
  datos: ParametroData;
  diferencias: Diferencia[];
}

export interface PlanImportacion {
  filas: FilaPlan[];
  iguales: number;
  errores: string[];
}

/** How a field reads, to compare and to show it. */
export function textoCampo(campo: Campo, d: ParametroData): string {
  switch (campo) {
    case "numero":
      return d.numero === null ? "" : String(d.numero);
    case "tdi":
      return `TDI-${d.tdi}`;
    case "ndi":
      return `NDI-${d.ndi}`;
    case "origen":
      return d.origen === "por_definir" ? "" : ORIGENES[d.origen];
    case "tipoDato":
      return TIPOS_DATO[d.tipoDato];
    case "valoresPermitidos":
      return d.valoresPermitidos.join("; ");
    case "min":
    case "max":
      return d.regla[campo] === null ? "" : String(d.regla[campo]);
    case "patron":
      return d.regla.patron;
    case "alias":
      return textoListaAlias(d.alias);
    case "activo":
      return d.activo ? "Sí" : "No";
    default:
      return String(d[campo] ?? "");
  }
}

function aplicar(base: ParametroData, entrada: Entrada): ParametroData {
  const d = entrada.datos;
  const out: ParametroData = { ...base, regla: { ...base.regla } };
  for (const campo of entrada.columnas) {
    if (campo === "min" || campo === "max" || campo === "patron") {
      if (d.regla) out.regla[campo] = d.regla[campo] as never;
    } else if (d[campo] !== undefined) {
      (out as unknown as Record<string, unknown>)[campo] = d[campo];
    }
  }
  return out;
}

function nuevoDesde(entrada: Entrada, codigo: string): ParametroData {
  const d = entrada.datos;
  const nombre = d.nombre ?? "";
  return {
    codigo,
    numero: d.numero ?? null,
    nombre,
    descripcion: d.descripcion ?? "",
    tdi: d.tdi ?? "A",
    ndi: d.ndi ?? 1,
    origen: d.origen ?? "por_definir",
    tipoDato: d.tipoDato ?? "texto",
    unidad: d.unidad ?? "",
    valoresPermitidos: d.valoresPermitidos ?? [],
    regla: { ...REGLA_VACIA, ...(d.regla ?? {}) },
    alias: d.alias ?? [{ grupo: "*", propiedad: nombre, sugerida: false }],
    idsUri: d.idsUri ?? "",
    activo: d.activo ?? true,
  };
}

/**
 * Matches each row with the catalog (by code, then N°, then name) and says
 * what is new, what would change (field by field) and how many are the same.
 * Rows repeated in the file are errors, as is a code another parameter uses.
 */
export function planificarImportacion(entradas: Entrada[], catalogo: Parametro[]): PlanImportacion {
  const porCodigo = new Map(catalogo.map((p) => [plegar(p.codigo), p]));
  const porNumero = new Map(catalogo.filter((p) => p.numero !== null).map((p) => [p.numero as number, p]));
  const porNombre = new Map(catalogo.map((p) => [plegar(p.nombre).replace(/\s+/g, " ").trim(), p]));
  const usados = new Set(catalogo.map((p) => plegar(p.codigo)));
  const vistos = new Map<string, number | null>();
  const filas: FilaPlan[] = [];
  const errores: string[] = [];
  let iguales = 0;
  let siguiente = 1;
  const codigoLibre = (numero: number | null) => {
    if (numero !== null && !usados.has(plegar(codigoDyco(numero)))) return codigoDyco(numero);
    let c: string;
    do c = `PAR-${String(siguiente++).padStart(3, "0")}`;
    while (usados.has(plegar(c)));
    return c;
  };

  for (const e of entradas) {
    const donde = e.fila === null ? `"${e.datos.nombre}"` : `Fila ${e.fila} ("${(e.datos.nombre ?? "").slice(0, 40)}")`;
    const existente =
      (e.datos.codigo ? porCodigo.get(plegar(e.datos.codigo)) : undefined) ??
      (e.datos.numero !== undefined && e.datos.numero !== null ? porNumero.get(e.datos.numero) : undefined) ??
      porNombre.get(plegar(e.datos.nombre ?? "").replace(/\s+/g, " ").trim()) ??
      null;
    const clave = existente ? `id:${existente.id}` : `nuevo:${plegar(e.datos.codigo ?? "")}|${e.datos.numero ?? ""}|${plegar(e.datos.nombre ?? "")}`;
    if (vistos.has(clave)) {
      errores.push(`${donde}: está repetido en el archivo; se toma solo la primera vez.`);
      continue;
    }
    vistos.set(clave, e.fila);

    if (!existente) {
      if (e.datos.codigo && usados.has(plegar(e.datos.codigo))) {
        errores.push(`${donde}: el código ${e.datos.codigo} ya lo usa otro parámetro.`);
        continue;
      }
      const codigo = e.datos.codigo ?? codigoLibre(e.datos.numero ?? null);
      usados.add(plegar(codigo));
      filas.push({ fila: e.fila, tipo: "nuevo", existente: null, datos: nuevoDesde(e, codigo), diferencias: [] });
      continue;
    }
    const datos = aplicar(existente, e);
    if (e.datos.codigo && plegar(e.datos.codigo) !== plegar(existente.codigo) && usados.has(plegar(e.datos.codigo))) {
      errores.push(`${donde}: el código ${e.datos.codigo} ya lo usa otro parámetro.`);
      continue;
    }
    const diferencias = e.columnas
      .map((campo) => ({ campo, antes: textoCampo(campo, existente), despues: textoCampo(campo, datos) }))
      .filter((d) => d.antes !== d.despues);
    if (diferencias.length === 0) iguales++;
    else filas.push({ fila: e.fila, tipo: "cambia", existente, datos, diferencias });
  }
  return { filas, iguales, errores };
}
