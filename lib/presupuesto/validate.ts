// Checks what clients send before it is stored, and returns it normalized
// (known fields only, trimmed text). Anything wrong is a 400 with a message
// the user can act on.
import { ServiceError } from "../propiedades/service";
import { DIAS_SEMANA, esFechaIso } from "./calendario";
import { VARIABLE_RE } from "./formula";
import { validarEsquema } from "./tree";
import {
  CalendarioLaboral,
  CampoModelo,
  ColumnaMemoria,
  Dependencia,
  DiaEspecial,
  Componente,
  Edt,
  FilaPie,
  FormatoGasto,
  GastosGenerales,
  InsumoData,
  Item,
  ItemGasto,
  MAX_CAMPOS_MODELO,
  MAX_COLUMNAS_MEMORIA,
  MAX_COMPONENTES,
  MAX_DIAS_ESPECIALES,
  MAX_DURACION_DIAS,
  MAX_PREDECESORAS,
  MAX_ITEMS,
  MAX_PIE,
  MAX_SHORT_TEXT,
  MAX_SUBPRESUPUESTOS,
  MAX_TEXT,
  PartidaData,
  PresupuestoDoc,
  Programacion,
  RedondeoDuracion,
  Subpartida,
  Subpresupuesto,
  TareaProgramada,
  TipoInsumo,
  TIPOS_DEPENDENCIA,
  TIPOS_INSUMO,
  TituloGasto,
} from "./types";

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new ServiceError(message, 400);
}

function obj(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${what}: se esperaba un objeto.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${what}: se esperaba una lista.`);
  if (value.length > max) fail(`${what}: máximo ${max} elementos.`);
  return value;
}

function text(value: unknown, what: string, max: number, required = false): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(`${what}: se esperaba texto.`);
  const t = value.trim();
  if (required && !t) fail(`${what} es obligatorio.`);
  if (t.length > max) fail(`${what}: máximo ${max} caracteres.`);
  return t;
}

function num(value: unknown, what: string, { min = 0, positive = false } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what}: se esperaba un número.`);
  if (positive ? value <= 0 : value < min) fail(`${what} debe ser ${positive ? "mayor que 0" : `mayor o igual a ${min}`}.`);
  if (Math.abs(value) > 1e13) fail(`${what}: el número es demasiado grande.`);
  return value;
}

function id(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) fail(`${what}: id no válido.`);
  return value;
}

function tipoInsumo(value: unknown, what: string): TipoInsumo {
  if (!TIPOS_INSUMO.includes(value as TipoInsumo)) fail(`${what}: el tipo debe ser MO, MT, EQ o SC.`);
  return value as TipoInsumo;
}

export function validarInsumo(value: unknown, what = "Insumo"): InsumoData {
  const o = obj(value, what);
  return {
    codigo: text(o.codigo, `${what} · código`, MAX_SHORT_TEXT),
    descripcion: text(o.descripcion, `${what} · descripción`, MAX_TEXT, true),
    unidad: text(o.unidad, `${what} · unidad`, 20),
    precio: num(o.precio, `${what} · precio`),
    tipo: tipoInsumo(o.tipo, what),
    iu: text(o.iu, `${what} · IU`, MAX_SHORT_TEXT),
    omniclass: text(o.omniclass, `${what} · OmniClass`, 60),
  };
}

function validarComponente(value: unknown, what: string): Componente {
  const o = obj(value, what);
  if (o.tipo !== "insumo" && o.tipo !== "subpartida") fail(`${what}: tipo de componente no válido.`);
  const cuadrilla = o.cuadrilla === null || o.cuadrilla === undefined ? null : num(o.cuadrilla, `${what} · cuadrilla`);
  return {
    tipo: o.tipo,
    id: id(o.id, what),
    cuadrilla: o.tipo === "subpartida" ? null : cuadrilla,
    cantidad: num(o.cantidad, `${what} · cantidad`),
  };
}

export function validarPartida(value: unknown, what = "Partida"): PartidaData {
  const o = obj(value, what);
  const descripcion = text(o.descripcion, `${what} · descripción`, MAX_TEXT, true);
  return {
    codigo: text(o.codigo, `${what} · código`, MAX_SHORT_TEXT),
    descripcion,
    unidad: text(o.unidad, `${what} · unidad`, 20),
    omniclass: text(o.omniclass, `${what} · OmniClass`, 60),
    rendimiento: num(o.rendimiento, `${what} "${descripcion}" · rendimiento`, { positive: true }),
    jornada: num(o.jornada, `${what} "${descripcion}" · jornada`, { positive: true }),
    ...validarEdt(o.edt, what),
    componentes: list(o.componentes, `${what} · insumos`, MAX_COMPONENTES).map((c, i) =>
      validarComponente(c, `${what} "${descripcion}" · línea ${i + 1}`)
    ),
  };
}

function validarItem(value: unknown, n: number): Item {
  const o = obj(value, `Fila ${n}`);
  const base = { id: id(o.id, `Fila ${n}`), nivel: o.nivel as number };
  if (!Number.isInteger(base.nivel)) fail(`Fila ${n}: nivel no válido.`);
  if (o.tipo === "titulo") {
    return { ...base, tipo: "titulo", descripcion: text(o.descripcion, `Fila ${n} · título`, MAX_TEXT, true) };
  }
  if (o.tipo !== "partida") fail(`Fila ${n}: debe ser un título o una partida.`);
  return {
    ...base,
    tipo: "partida",
    ...validarPartida(o, `Fila ${n}`),
    metrado: num(o.metrado, `Fila ${n} · metrado`),
    origenId: o.origenId ? id(o.origenId, `Fila ${n} · origen`) : null,
    ...(o.modo === "manual" || o.modo === "3d" ? { modo: o.modo } : {}),
  };
}

const MAX_EDT = 2000;

/** The EDT dictionary, only when something was written. */
function validarEdt(value: unknown, what: string): { edt?: Edt } {
  if (value === undefined || value === null) return {};
  const o = obj(value, `${what} · EDT`);
  const edt = {
    descripcion: text(o.descripcion, `${what} · descripción del trabajo`, MAX_EDT),
    criterios: text(o.criterios, `${what} · criterios de aceptación`, MAX_EDT),
    responsable: text(o.responsable, `${what} · responsable`, 120),
  };
  return edt.descripcion || edt.criterios || edt.responsable ? { edt } : {};
}

function validarPie(value: unknown, sp: string): FilaPie[] {
  return list(value, `Pie de ${sp}`, MAX_PIE).map((v, i) => {
    const o = obj(v, `Pie de ${sp} · fila ${i + 1}`);
    const variable = text(o.variable, `Pie de ${sp} · variable`, 20, true);
    if (!VARIABLE_RE.test(variable)) fail(`Pie de ${sp}: la variable "${variable}" no es válida.`);
    return {
      variable,
      descripcion: text(o.descripcion, `Pie de ${sp} · descripción`, MAX_TEXT),
      formula: text(o.formula, `Pie de ${sp} · fórmula`, 200),
      iu: text(o.iu, `Pie de ${sp} · IU`, MAX_SHORT_TEXT),
      resaltar: o.resaltar === true,
    };
  });
}

function validarSubpresupuesto(value: unknown, n: number): Subpresupuesto {
  const o = obj(value, `Subpresupuesto ${n}`);
  const nombre = text(o.nombre, `Subpresupuesto ${n} · nombre`, 120, true);
  const items = list(o.items, `Subpresupuesto ${nombre}`, MAX_ITEMS).map((v, i) => validarItem(v, i + 1));
  const error = validarEsquema(items);
  if (error) fail(`${nombre}: ${error}`);
  return { id: id(o.id, `Subpresupuesto ${nombre}`), nombre, items, pie: validarPie(o.pie, nombre) };
}

function validarGastos(value: unknown): GastosGenerales {
  const o = obj(value, "Gastos generales");
  const titulos = (v: unknown, grupo: string): TituloGasto[] =>
    list(v, `Gastos generales ${grupo}`, 200).map((t, i) => {
      const to = obj(t, `Gastos ${grupo} · título ${i + 1}`);
      const formato: FormatoGasto = to.formato === "personal" ? "personal" : "general";
      return {
        id: id(to.id, `Gastos ${grupo} · título ${i + 1}`),
        descripcion: text(to.descripcion, `Gastos ${grupo} · título ${i + 1}`, MAX_TEXT, true),
        formato,
        items: list(to.items, `Gastos ${grupo} · título ${i + 1}`, 500).map((it, k): ItemGasto => {
          const io = obj(it, `Gastos ${grupo} · ítem ${k + 1}`);
          const w = `Gastos ${grupo} · ítem ${i + 1}.${k + 1}`;
          return {
            id: id(io.id, w),
            descripcion: text(io.descripcion, `${w} · descripción`, MAX_TEXT),
            unidad: text(io.unidad, `${w} · unidad`, 20),
            cantidad: num(io.cantidad, `${w} · cantidad`),
            precio: num(io.precio, `${w} · precio`),
            participacion: num(io.participacion ?? 100, `${w} · participación`),
            tiempo: num(io.tiempo ?? 1, `${w} · tiempo`),
          };
        }),
      };
    });
  return { fijos: titulos(o.fijos, "fijos"), variables: titulos(o.variables, "variables") };
}

/** The whole budget: shape, outline, unique ids, and references that resolve. */
export function validarDocumento(value: unknown): PresupuestoDoc {
  const o = obj(value, "Presupuesto");
  const subpresupuestos = list(o.subpresupuestos, "Subpresupuestos", MAX_SUBPRESUPUESTOS).map((v, i) =>
    validarSubpresupuesto(v, i + 1)
  );
  if (subpresupuestos.length === 0) fail("El presupuesto necesita al menos un subpresupuesto.");

  const insumos: Record<string, InsumoData> = {};
  for (const [key, v] of Object.entries(obj(o.insumos ?? {}, "Precios del presupuesto"))) {
    insumos[id(key, "Insumo del presupuesto")] = validarInsumo(v, "Insumo del presupuesto");
  }
  const subpartidas: Record<string, Subpartida> = {};
  for (const [key, v] of Object.entries(obj(o.subpartidas ?? {}, "Subpartidas"))) {
    const so = obj(v, "Subpartida");
    subpartidas[id(key, "Subpartida")] = {
      ...validarPartida(so, "Subpartida"),
      origenId: so.origenId ? id(so.origenId, "Subpartida · origen") : null,
    };
  }

  const ids = new Set<string>();
  const total = subpresupuestos.reduce((sum, sp) => sum + sp.items.length, 0);
  if (total > MAX_ITEMS) fail(`El presupuesto supera las ${MAX_ITEMS} filas.`);
  for (const sp of subpresupuestos) {
    if (ids.has(sp.id)) fail("Hay ids repetidos en el presupuesto.");
    ids.add(sp.id);
    for (const item of sp.items) {
      if (ids.has(item.id)) fail("Hay filas con el mismo id.");
      ids.add(item.id);
    }
  }

  const apus = [
    ...subpresupuestos.flatMap((sp) => sp.items.flatMap((i) => (i.tipo === "partida" ? [i] : []))),
    ...Object.values(subpartidas),
  ];
  for (const apu of apus) {
    for (const c of apu.componentes) {
      const ok = c.tipo === "insumo" ? insumos[c.id] : subpartidas[c.id];
      if (!ok) fail(`"${apu.descripcion}" usa un ${c.tipo === "insumo" ? "insumo" : "subpartida"} que no está en el presupuesto.`);
    }
  }

  return { subpresupuestos, insumos, subpartidas, gastos: validarGastos(o.gastos ?? { fijos: [], variables: [] }) };
}

/** The columns of the memoria de cantidades chosen by the user. */
export function validarColumnasMemoria(value: unknown): ColumnaMemoria[] {
  const lista = list(value, "Columnas de la memoria", MAX_COLUMNAS_MEMORIA);
  const ids = new Set<string>();
  return lista.map((v, i) => {
    const o = obj(v, `Columna ${i + 1}`);
    const colId = id(o.id, `Columna ${i + 1}`);
    if (colId.length > 40) fail(`Columna ${i + 1}: id demasiado largo.`);
    if (ids.has(colId)) fail("Hay columnas repetidas.");
    ids.add(colId);
    const fuente = o.fuente;
    if (fuente !== "modelo" && fuente !== "propiedad" && fuente !== "ifcguid") fail(`Columna ${i + 1}: origen no válido.`);
    const label = text(o.label, `Columna ${i + 1} · título`, 40, true);
    let clave = fuente === "ifcguid" ? "" : text(o.clave, `Columna ${i + 1} · propiedad`, 100, true);
    if (fuente === "propiedad" && !UUID_RE.test(clave)) fail(`Columna ${i + 1}: atributo no válido.`);
    if (fuente === "propiedad") clave = clave.toLowerCase();
    return { id: colId, label, fuente, clave };
  });
}

/** The properties of the models as read in the viewer. */
export function validarCamposModelo(value: unknown): { modelos: string[]; campos: CampoModelo[] } {
  const o = obj(value, "Propiedades de los modelos");
  const modelos = list(o.modelos ?? [], "Modelos", 50).map((m) => text(m, "Modelo", 200));
  const vistos = new Set<string>();
  const campos: CampoModelo[] = [];
  for (const v of list(o.campos, "Propiedades", MAX_CAMPOS_MODELO)) {
    const c = obj(v, "Propiedad");
    const key = text(c.key, "Propiedad", 200, true);
    if (vistos.has(key)) continue;
    vistos.add(key);
    const kind = c.kind === "number" || c.kind === "date" ? c.kind : "text";
    const count = typeof c.count === "number" && Number.isFinite(c.count) ? Math.max(0, Math.floor(c.count)) : 0;
    campos.push({ key, label: text(c.label, "Propiedad", 120, true), group: text(c.group, "Propiedad", 120), kind, count });
  }
  return { modelos, campos };
}

/** Item ids of the budget's partidas. */
export function idsDePartidas(doc: PresupuestoDoc): Set<string> {
  return new Set(doc.subpresupuestos.flatMap((sp) => sp.items.filter((i) => i.tipo === "partida").map((i) => i.id)));
}

// ---------------------------------------------------------------- schedule

function fechaIso(value: unknown, what: string): string {
  if (!esFechaIso(value)) fail(`${what}: fecha no válida.`);
  return value;
}

function horas(value: unknown, what: string): number {
  const h = num(value, what);
  if (h > 24) fail(`${what}: máximo 24 horas.`);
  return h;
}

function validarCalendario(value: unknown): CalendarioLaboral {
  const c = obj(value, "Calendario");
  const semana = list(c.horasSemana, "Horas de cada día de la semana", 7);
  if (semana.length !== 7) fail("Calendario: se esperaban las horas de los 7 días de la semana.");
  const horasSemana = semana.map((h, i) => horas(h, `Horas del ${DIAS_SEMANA[i].toLowerCase()}`));
  if (!horasSemana.some((h) => h > 0)) fail("El calendario necesita al menos un día de la semana con horas de trabajo.");
  const jornada = num(c.jornada, "Horas de una jornada", { positive: true });
  if (jornada > 24) fail("Horas de una jornada: máximo 24.");
  const fechas = new Set<string>();
  const especiales: DiaEspecial[] = list(c.especiales ?? [], "Días especiales", MAX_DIAS_ESPECIALES).map((v, i) => {
    const d = obj(v, `Día especial ${i + 1}`);
    const fecha = fechaIso(d.fecha, `Día especial ${i + 1}`);
    if (fechas.has(fecha)) fail(`El día ${fecha.split("-").reverse().join("-")} está repetido en el calendario.`);
    fechas.add(fecha);
    return { fecha, horas: horas(d.horas, `Horas del ${fecha}`), nombre: text(d.nombre, `Nombre del día ${fecha}`, 80) };
  });
  especiales.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { horasSemana, jornada, especiales };
}

function validarTarea(value: unknown, what: string): TareaProgramada | null {
  const t = obj(value, what);
  const out: TareaProgramada = {};
  if (t.duracion !== undefined && t.duracion !== null) {
    out.duracion = redondear2(num(t.duracion, `${what}: duración`));
    if (out.duracion > MAX_DURACION_DIAS) fail(`${what}: duración máxima ${MAX_DURACION_DIAS} días.`);
  }
  if (t.cuadrillas !== undefined && t.cuadrillas !== null) {
    out.cuadrillas = num(t.cuadrillas, `${what}: cuadrillas`, { positive: true });
    if (out.cuadrillas > 1000) fail(`${what}: máximo 1000 cuadrillas.`);
    if (out.cuadrillas === 1) delete out.cuadrillas;
  }
  if (t.inicio !== undefined && t.inicio !== null && t.inicio !== "") out.inicio = fechaIso(t.inicio, `${what}: inicio`);
  if (t.predecesoras !== undefined) {
    const vistos = new Set<string>();
    const deps: Dependencia[] = list(t.predecesoras, `${what}: predecesoras`, MAX_PREDECESORAS).map((v) => {
      const d = obj(v, `${what}: predecesora`);
      const depId = id(d.id, `${what}: predecesora`);
      if (vistos.has(depId)) fail(`${what}: una predecesora está repetida.`);
      vistos.add(depId);
      if (!TIPOS_DEPENDENCIA.includes(d.tipo as Dependencia["tipo"])) fail(`${what}: el tipo de enlace debe ser FC, CC, FF o CF.`);
      const desfase = redondear2(num(d.desfase ?? 0, `${what}: desfase`, { min: -MAX_DURACION_DIAS }));
      if (desfase > MAX_DURACION_DIAS) fail(`${what}: desfase demasiado grande.`);
      return { id: depId, tipo: d.tipo as Dependencia["tipo"], desfase };
    });
    if (deps.length) out.predecesoras = deps;
  }
  return Object.keys(out).length ? out : null;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

export function validarProgramacion(value: unknown): Programacion {
  const o = obj(value, "Programación");
  const inicio = fechaIso(o.inicio, "Inicio del proyecto");
  const finObjetivo = o.finObjetivo === null || o.finObjetivo === undefined || o.finObjetivo === "" ? null : fechaIso(o.finObjetivo, "Fecha fin");
  if (finObjetivo && finObjetivo < inicio) fail("La fecha fin no puede ser anterior al inicio del proyecto.");
  const redondeo = (o.redondeo ?? "dia") as RedondeoDuracion;
  if (!["dia", "medio", "no"].includes(redondeo)) fail("Redondeo de la duración no válido.");
  const crudo = obj(o.tareas ?? {}, "Tareas");
  const entradas = Object.entries(crudo);
  if (entradas.length > MAX_ITEMS) fail(`Tareas: máximo ${MAX_ITEMS}.`);
  const tareas: Record<string, TareaProgramada> = {};
  for (const [k, v] of entradas) {
    const t = validarTarea(v, `Tarea ${id(k, "Tarea")}`);
    if (t) tareas[k] = t;
  }
  return { inicio, finObjetivo, calendario: validarCalendario(o.calendario), redondeo, tareas };
}
