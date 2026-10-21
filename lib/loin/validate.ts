// Everything that comes from the browser is checked here before it reaches
// the service's rules or the database.
import { ServiceError } from "../propiedades/service";
import type { Responsable } from "../propiedades/types";
import { normalizarNombre } from "./alias";
import { errorPatron } from "./reglas";
import {
  Alias,
  DisciplinaData,
  ElementoData,
  GrupoTdi,
  MAX_ALIAS,
  MAX_CORTO,
  MAX_EDITORES,
  MAX_PARAMETROS_ELEMENTO,
  MAX_TEXTO,
  MAX_VALORES_BASURA,
  MAX_VALORES_PERMITIDOS,
  Ndi,
  ORIGENES,
  ParametroData,
  ParametroExigido,
  ReglaValor,
  TIPOS_DATO,
} from "./types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bad(message: string): never {
  throw new ServiceError(message, 400);
}

type Obj = Record<string, unknown>;
const objeto = (v: unknown, donde: string): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v)) bad(`${donde}: datos no válidos.`);
  return v as Obj;
};

function texto(v: unknown, donde: string, max: number, requerido = false): string {
  if (v === undefined || v === null) {
    if (requerido) bad(`${donde}: falta.`);
    return "";
  }
  if (typeof v !== "string") bad(`${donde}: debe ser texto.`);
  const t = v.trim();
  if (requerido && !t) bad(`${donde}: falta.`);
  if (t.length > max) bad(`${donde}: máximo ${max} caracteres.`);
  return t;
}

function booleano(v: unknown, donde: string, porDefecto: boolean): boolean {
  if (v === undefined) return porDefecto;
  if (typeof v !== "boolean") bad(`${donde}: debe ser sí o no.`);
  return v;
}

function entero(v: unknown, donde: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) bad(`${donde}: número no válido.`);
  return v as number;
}

function numeroONulo(v: unknown, donde: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${donde}: debe ser un número.`);
  return v;
}

export function leerId(v: unknown, donde = "Id"): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) bad(`${donde} no válido.`);
  return v.toLowerCase();
}

export function leerVersion(v: unknown): number {
  if (!Number.isInteger(v) || (v as number) < 0) bad("Falta la versión del registro.");
  return v as number;
}

function leerNdi(v: unknown, donde: string): Ndi {
  if (v !== 1 && v !== 2 && v !== 3) bad(`${donde}: el NDI debe ser 1, 2 o 3.`);
  return v;
}

export function leerRegla(v: unknown, donde: string): ReglaValor {
  if (v === undefined || v === null) return { min: null, max: null, patron: "" };
  const o = objeto(v, donde);
  const min = numeroONulo(o.min, `${donde} (mínimo)`);
  const max = numeroONulo(o.max, `${donde} (máximo)`);
  if (min !== null && max !== null && min > max) bad(`${donde}: el mínimo es mayor que el máximo.`);
  const patron = texto(o.patron, `${donde} (patrón)`, 300);
  const e = errorPatron(patron);
  if (e) bad(`${donde}: ${e}`);
  return { min, max, patron };
}

function leerAlias(v: unknown, donde: string): Alias[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) bad(`${donde}: se esperaba una lista.`);
  if (v.length > MAX_ALIAS) bad(`${donde}: máximo ${MAX_ALIAS} equivalencias.`);
  const vistos = new Set<string>();
  const out: Alias[] = [];
  v.forEach((a, i) => {
    const o = objeto(a, `${donde} ${i + 1}`);
    const grupo = texto(o.grupo, `${donde} ${i + 1} (grupo)`, 120, true);
    const propiedad = texto(o.propiedad, `${donde} ${i + 1} (propiedad)`, MAX_CORTO, true);
    const clave = `${normalizarNombre(grupo)}|${normalizarNombre(propiedad)}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    out.push({ grupo, propiedad, sugerida: booleano(o.sugerida, `${donde} ${i + 1}`, false) });
  });
  return out;
}

export function leerParametro(v: unknown, donde: string): ParametroData {
  const o = objeto(v, donde);
  const nombre = texto(o.nombre, `${donde} (nombre)`, MAX_CORTO, true);
  const d = `${donde} "${nombre.slice(0, 40)}"`;
  const tdi = texto(o.tdi, `${d} (TDI)`, 1, true).toUpperCase();
  if (!/^[A-Z]$/.test(tdi)) bad(`${d}: el TDI debe ser una letra.`);
  const origen = o.origen as ParametroData["origen"];
  if (!(typeof origen === "string" && origen in ORIGENES)) bad(`${d}: origen del dato no válido.`);
  const tipoDato = o.tipoDato as ParametroData["tipoDato"];
  if (!(typeof tipoDato === "string" && tipoDato in TIPOS_DATO)) bad(`${d}: tipo de dato no válido.`);
  if (!Array.isArray(o.valoresPermitidos ?? [])) bad(`${d}: los valores permitidos deben ser una lista.`);
  const valores: string[] = [];
  const vistos = new Set<string>();
  for (const x of (o.valoresPermitidos ?? []) as unknown[]) {
    const t = texto(x, `${d} (valor permitido)`, MAX_CORTO);
    if (!t || vistos.has(normalizarNombre(t))) continue;
    vistos.add(normalizarNombre(t));
    valores.push(t);
  }
  if (valores.length > MAX_VALORES_PERMITIDOS) bad(`${d}: máximo ${MAX_VALORES_PERMITIDOS} valores permitidos.`);
  if (tipoDato === "lista" && valores.length === 0) bad(`${d}: una lista de valores necesita al menos un valor permitido.`);
  const idsUri = texto(o.idsUri, `${d} (URI)`, 500);
  if (idsUri && !/^https?:\/\/\S+$/i.test(idsUri)) bad(`${d}: la URI IDS / bSDD debe empezar por http:// o https://.`);
  const numero = o.numero === null || o.numero === undefined ? null : entero(o.numero, `${d} (N°)`, 1, 100000);
  return {
    codigo: texto(o.codigo, `${d} (código)`, 40, true),
    numero,
    nombre,
    descripcion: texto(o.descripcion, `${d} (descripción)`, MAX_TEXTO),
    tdi,
    ndi: leerNdi(o.ndi, d),
    origen,
    tipoDato,
    unidad: texto(o.unidad, `${d} (unidad)`, 20),
    valoresPermitidos: valores,
    regla: leerRegla(o.regla, d),
    alias: leerAlias(o.alias, `${d} (equivalencia)`),
    idsUri,
    activo: booleano(o.activo, d, true),
  };
}

export function leerDisciplina(v: unknown): DisciplinaData {
  const o = objeto(v, "Disciplina");
  const codigo = texto(o.codigo, "Código de la disciplina", 20, true);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(codigo)) bad("El código de la disciplina solo lleva letras, números, punto, guion o guion bajo (sin espacios).");
  const color = texto(o.color, "Color de la disciplina", 7, true);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) bad("El color de la disciplina no es válido.");
  return {
    codigo,
    nombre: texto(o.nombre, "Nombre de la disciplina", 120, true),
    color: color.toLowerCase(),
    orden: o.orden === undefined ? 0 : entero(o.orden, "Orden", -100000, 100000),
    activo: booleano(o.activo, "Disciplina", true),
  };
}

function leerExigidos(v: unknown): ParametroExigido[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) bad("Parámetros exigidos: se esperaba una lista.");
  if (v.length > MAX_PARAMETROS_ELEMENTO) bad(`Máximo ${MAX_PARAMETROS_ELEMENTO} parámetros exigidos por elemento.`);
  const vistos = new Set<string>();
  const out: ParametroExigido[] = [];
  v.forEach((x, i) => {
    const o = objeto(x, `Parámetro exigido ${i + 1}`);
    const parametroId = leerId(o.parametroId, `Parámetro exigido ${i + 1}`);
    if (vistos.has(parametroId)) return;
    vistos.add(parametroId);
    out.push({
      parametroId,
      obligatorio: booleano(o.obligatorio, `Parámetro exigido ${i + 1}`, true),
      ndi: o.ndi === null || o.ndi === undefined ? null : leerNdi(o.ndi, `Parámetro exigido ${i + 1}`),
      regla: o.regla === null || o.regla === undefined ? null : leerRegla(o.regla, `Parámetro exigido ${i + 1}`),
    });
  });
  return out;
}

export function leerElemento(v: unknown): ElementoData {
  const o = objeto(v, "Elemento");
  const codigo = texto(o.codigo, "Código del elemento", 30, true);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(codigo)) bad("El código del elemento solo lleva letras, números, punto, guion o guion bajo (sin espacios).");
  let claseIfc = texto(o.claseIfc, "Clase IFC", 64);
  if (claseIfc) {
    if (!/^ifc[A-Za-z0-9]+$/i.test(claseIfc)) bad(`"${claseIfc}" no es una clase IFC (se escriben como IfcWall, IfcSlab, IfcDoor…).`);
    claseIfc = `Ifc${claseIfc.slice(3)}`;
  }
  const tipoPredefinido = texto(o.tipoPredefinido, "Tipo predefinido", 64).toUpperCase();
  if (tipoPredefinido && !/^[A-Z0-9_]+$/.test(tipoPredefinido)) bad("El tipo predefinido se escribe en mayúsculas sin espacios (p. ej. SOLIDWALL, FLOOR).");
  return {
    disciplinaId: leerId(o.disciplinaId, "Disciplina"),
    codigo,
    nombre: texto(o.nombre, "Nombre del elemento", MAX_CORTO, true),
    claseIfc,
    tipoPredefinido,
    clasificacionSistema: texto(o.clasificacionSistema, "Sistema de clasificación", 40),
    clasificacionCodigo: texto(o.clasificacionCodigo, "Código de clasificación", 60),
    notas: texto(o.notas, "Notas de modelado", MAX_TEXTO),
    parametros: leerExigidos(o.parametros),
    orden: o.orden === undefined ? 0 : entero(o.orden, "Orden", -100000, 100000),
    activo: booleano(o.activo, "Elemento", true),
  };
}

export function leerGruposTdi(v: unknown): GrupoTdi[] {
  if (!Array.isArray(v) || v.length === 0) bad("Debe haber al menos un grupo TDI.");
  if (v.length > 26) bad("Máximo 26 grupos TDI (una letra cada uno).");
  const vistos = new Set<string>();
  return v.map((x, i) => {
    const o = objeto(x, `Grupo TDI ${i + 1}`);
    const codigo = texto(o.codigo, `Grupo TDI ${i + 1} (letra)`, 1, true).toUpperCase();
    if (!/^[A-Z]$/.test(codigo)) bad(`Grupo TDI ${i + 1}: la letra debe ser de la A a la Z.`);
    if (vistos.has(codigo)) bad(`La letra ${codigo} está repetida en los grupos TDI.`);
    vistos.add(codigo);
    return { codigo, nombre: texto(o.nombre, `Grupo TDI-${codigo} (nombre)`, 120, true) };
  });
}

export function leerValoresBasura(v: unknown): string[] {
  if (!Array.isArray(v)) bad("Los valores de relleno deben ser una lista.");
  if (v.length > MAX_VALORES_BASURA) bad(`Máximo ${MAX_VALORES_BASURA} valores de relleno.`);
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const t = texto(x, "Valor de relleno", 60);
    if (!t || vistos.has(normalizarNombre(t))) continue;
    vistos.add(normalizarNombre(t));
    out.push(t);
  }
  return out;
}

export function leerUmbral(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 99) bad("El umbral del amarillo debe estar entre 0 y 99 %.");
  return Math.round(v);
}

export function leerEditores(value: unknown): Responsable[] {
  if (!Array.isArray(value)) bad("Los editores deben ser una lista.");
  if (value.length > MAX_EDITORES) bad(`Máximo ${MAX_EDITORES} editores.`);
  const seen = new Set<string>();
  const out: Responsable[] = [];
  for (const v of value) {
    const r = v as Partial<Responsable> | null;
    if (!r || (r.type !== "user" && r.type !== "group") || typeof r.id !== "string" || !r.id || r.id.length > 100) bad("Editor no válido.");
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: r.type, id: r.id, name: typeof r.name === "string" ? r.name.slice(0, 200) : r.id });
  }
  return out;
}
